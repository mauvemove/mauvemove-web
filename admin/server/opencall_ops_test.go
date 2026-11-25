package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeOpencallOps 는 오픈콜 문의·추천 API 를 흉내 낸다. 받은 것을 봉투의 data 에 담아 돌려준다.
func fakeOpencallOps(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	echo := func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "nope", http.StatusForbidden)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code": "OK", "message": "ok", "txId": "x",
			"data": map[string]string{
				"method": r.Method, "path": r.URL.Path, "query": r.URL.RawQuery, "body": string(raw),
				"type": r.Header.Get("Content-Type"), "admin": r.Header.Get(adminUserHeader),
			},
		})
	}
	mux.HandleFunc("GET /api/admin/contacts", echo)
	mux.HandleFunc("GET /api/admin/contacts/{id}", func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("id") == "404" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"code":"NOT_FOUND","message":"contact not found"}`))
			return
		}
		echo(w, r)
	})
	mux.HandleFunc("POST /api/admin/contacts/{id}/reply", echo)
	mux.HandleFunc("PATCH /api/admin/contacts/{id}", func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("id") == "400" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"code":"INVALID_REQUEST","message":"invalid input: status"}`))
			return
		}
		echo(w, r)
	})
	mux.HandleFunc("GET /api/admin/referrals", echo)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func send(h http.Handler, method, target, contentType, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	h.ServeHTTP(rec, req)
	return rec
}

func TestOpencallContactsProxy(t *testing.T) {
	h := testServer(t, fakeOpencallOps(t).URL, "secret")

	cases := []struct {
		name, method, target, ctype, body string
		wantStatus                        int
		want                              map[string]string
	}{
		{"list", "GET", "/api/opencall/contacts?status=open&category=bug&limit=50&offset=0", "", "", 200,
			map[string]string{"path": "/api/admin/contacts", "query": "category=bug&limit=50&offset=0&status=open"}},
		{"list all", "GET", "/api/opencall/contacts", "", "", 200, map[string]string{"query": ""}},
		{"bad status", "GET", "/api/opencall/contacts?status=spam", "", "", 400, nil},
		{"bad category", "GET", "/api/opencall/contacts?category=a%26b", "", "", 400, nil},
		{"bad limit", "GET", "/api/opencall/contacts?limit=-1", "", "", 400, nil},
		{"one", "GET", "/api/opencall/contacts/7", "", "", 200, map[string]string{"path": "/api/admin/contacts/7"}},
		{"bad id", "GET", "/api/opencall/contacts/abc", "", "", 400, nil},
		{"not found", "GET", "/api/opencall/contacts/404", "", "", 404, nil},
		{"reply", "POST", "/api/opencall/contacts/7/reply", "application/json", `{"answer":"  고쳤어요 ","extra":1}`, 200,
			map[string]string{"method": "POST", "path": "/api/admin/contacts/7/reply", "body": `{"answer":"고쳤어요"}`, "type": "application/json", "admin": "dev@example.com"}},
		{"reply empty", "POST", "/api/opencall/contacts/7/reply", "application/json", `{"answer":"   "}`, 400, nil},
		{"reply too long", "POST", "/api/opencall/contacts/7/reply", "application/json", `{"answer":"` + strings.Repeat("가", maxAnswerRunes+1) + `"}`, 400, nil},
		{"reply form post (csrf)", "POST", "/api/opencall/contacts/7/reply", "application/x-www-form-urlencoded", "answer=x", 415, nil},
		{"reply no json", "POST", "/api/opencall/contacts/7/reply", "application/json", "x", 400, nil},
		{"close", "PATCH", "/api/opencall/contacts/7", "application/json; charset=utf-8", `{"status":"closed"}`, 200,
			map[string]string{"method": "PATCH", "body": `{"status":"closed"}`}},
		{"close bad status", "PATCH", "/api/opencall/contacts/7", "application/json", `{"status":"gone"}`, 400, nil},
		{"upstream rejects", "PATCH", "/api/opencall/contacts/400", "application/json", `{"status":"open"}`, 400, nil},
		{"referrals", "GET", "/api/opencall/referrals?code=Abc1&limit=100", "", "", 200,
			map[string]string{"path": "/api/admin/referrals", "query": "code=abc1&limit=100"}},
		{"referrals bad code", "GET", "/api/opencall/referrals?code=a-b", "", "", 400, nil},
		{"referrals bad limit", "GET", "/api/opencall/referrals?limit=0", "", "", 400, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := send(h, c.method, c.target, c.ctype, c.body)
			if rec.Code != c.wantStatus {
				t.Fatalf("status %d, want %d: %s", rec.Code, c.wantStatus, rec.Body)
			}
			if c.want == nil {
				var e map[string]string
				if err := json.Unmarshal(rec.Body.Bytes(), &e); err != nil || e["message"] == "" {
					t.Fatalf("error body without message: %s", rec.Body)
				}
				return
			}
			// 봉투가 벗겨져 data 만 와야 한다.
			var got map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("body %s: %v", rec.Body, err)
			}
			for k, v := range c.want {
				if got[k] != v {
					t.Errorf("%s = %q, want %q", k, got[k], v)
				}
			}
		})
	}
}

func TestOpencallContactsNotConfigured(t *testing.T) {
	h := testServer(t, fakeOpencallOps(t).URL, "")
	for _, rec := range []*httptest.ResponseRecorder{
		send(h, "GET", "/api/opencall/contacts", "", ""),
		send(h, "GET", "/api/opencall/referrals", "", ""),
		send(h, "POST", "/api/opencall/contacts/1/reply", "application/json", `{"answer":"a"}`),
	} {
		if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "not_configured") {
			t.Errorf("got %d %s", rec.Code, rec.Body)
		}
	}
}

func TestOpencallUpstreamAuthFailureIsBadGateway(t *testing.T) {
	h := testServer(t, fakeOpencallOps(t).URL, "wrong")
	if rec := send(h, "GET", "/api/opencall/contacts", "", ""); rec.Code != http.StatusBadGateway {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
}
