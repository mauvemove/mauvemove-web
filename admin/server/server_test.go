package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testServer(t *testing.T, upstream string, token string) http.Handler {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>admin</html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := config{
		StaticDir:          dir,
		OpencallAdminToken: token,
		Services: []service{
			{ID: "opencall", Name: "오픈콜", APIURL: upstream},
			{ID: "nongolbus", Name: "논골버스", APIURL: upstream},
			{ID: "lottosmash", Name: "로또스매시", APIURL: upstream + "/down"},
		},
	}
	return newServer(cfg, devAuth{email: "dev@example.com"}).routes()
}

func fakeUpstream(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/api/version", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != userAgent {
			http.Error(w, "blocked", http.StatusForbidden)
			return
		}
		_, _ = w.Write([]byte(`{"code":"OK","data":{"version":"1.2.3"}}`))
	})
	mux.HandleFunc("/api/notices", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("platform") == "ios" {
			_, _ = w.Write([]byte(`{"notices":[]}`))
			return
		}
		_, _ = w.Write([]byte(`{"notices":[{"id":"a","title":"t","body":"b"}]}`))
	})
	mux.HandleFunc("/api/admin/ads/stats", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "nope", http.StatusForbidden)
			return
		}
		_, _ = w.Write([]byte(`{"total_revenue_micros":5,"by_feature":[],"by_user":[]}`))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func get(h http.Handler, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestServices(t *testing.T) {
	up := fakeUpstream(t)
	rec := get(testServer(t, up.URL, ""), "/api/services")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var body struct {
		Services []serviceStatus `json:"services"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Services) != 3 {
		t.Fatalf("services = %d, want 3", len(body.Services))
	}
	if s := body.Services[0]; s.ID != "opencall" || !s.OK || s.Version != "1.2.3" {
		t.Errorf("opencall = %+v", s)
	}
	if s := body.Services[2]; s.OK || s.Error == "" {
		t.Errorf("down service should report an error: %+v", s)
	}
}

func TestNongolbusNotices(t *testing.T) {
	up := fakeUpstream(t)
	rec := get(testServer(t, up.URL, ""), "/api/nongolbus/notices")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	var body map[string][]map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body["android"]) != 1 || len(body["ios"]) != 0 {
		t.Errorf("body = %v", body)
	}
}

func TestOpencallAdsStats(t *testing.T) {
	up := fakeUpstream(t)
	const target = "/api/opencall/ads/stats?from=2026-11-01&to=2026-11-20"

	if rec := get(testServer(t, up.URL, ""), target); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("without token: status = %d, want 503", rec.Code)
	}
	if rec := get(testServer(t, up.URL, "secret"), "/api/opencall/ads/stats?from=x&to=y"); rec.Code != http.StatusBadRequest {
		t.Errorf("bad dates: status = %d, want 400", rec.Code)
	}
	if rec := get(testServer(t, up.URL, "wrong"), target); rec.Code != http.StatusBadGateway {
		t.Errorf("wrong token: status = %d, want 502", rec.Code)
	}
	rec := get(testServer(t, up.URL, "secret"), target)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"total_revenue_micros":5`) {
		t.Errorf("status = %d, body = %s", rec.Code, rec.Body)
	}
}

func TestStaticFallsBackToIndex(t *testing.T) {
	up := fakeUpstream(t)
	h := testServer(t, up.URL, "")
	for _, target := range []string{"/", "/opencall", "/nongolbus/notices"} {
		rec := get(h, target)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "admin") {
			t.Errorf("%s: status = %d, body = %q", target, rec.Code, rec.Body)
		}
	}
	if rec := get(h, "/api/unknown"); rec.Code != http.StatusNotFound {
		t.Errorf("/api/unknown: status = %d, want 404", rec.Code)
	}
	// ServeMux 는 ".." 가 든 경로를 정리된 주소로 리다이렉트한다. 정적 디렉터리 밖으로 나가지 않는다.
	if rec := get(h, "/../../etc/passwd"); rec.Code != http.StatusMovedPermanently || rec.Header().Get("Location") != "/etc/passwd" {
		t.Errorf("traversal: status = %d, location = %q", rec.Code, rec.Header().Get("Location"))
	}
	req := httptest.NewRequest(http.MethodPost, "/opencall", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /opencall: status = %d, want 405", rec.Code)
	}
}

func TestRequireUserRejects(t *testing.T) {
	auth := &iapAuth{audience: "aud", now: time.Now}
	h := newServer(config{}, auth).routes()
	if rec := get(h, "/api/me"); rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
}

// ── IAP 서명 검증 ─────────────────────────────────────────────────────

func b64(v []byte) string { return base64.RawURLEncoding.EncodeToString(v) }

func signToken(t *testing.T, key *ecdsa.PrivateKey, kid string, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"alg": "ES256", "typ": "JWT", "kid": kid})
	payload, _ := json.Marshal(claims)
	input := b64(header) + "." + b64(payload)
	digest := sha256.Sum256([]byte(input))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return input + "." + b64(sig)
}

func TestIAPVerify(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)

	x, y := make([]byte, 32), make([]byte, 32)
	key.PublicKey.X.FillBytes(x)
	key.PublicKey.Y.FillBytes(y)
	keys := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{
			{"kid": "k1", "kty": "EC", "crv": "P-256", "x": b64(x), "y": b64(y)},
		}})
	}))
	defer keys.Close()

	now := time.Unix(1_800_000_000, 0)
	auth := &iapAuth{audience: "aud", keysURL: keys.URL, client: keys.Client(), now: func() time.Time { return now }}

	claims := func(mod func(map[string]any)) map[string]any {
		c := map[string]any{
			"iss":   iapIssuer,
			"aud":   "aud",
			"iat":   now.Unix() - 10,
			"exp":   now.Unix() + 600,
			"email": "owner@example.com",
		}
		if mod != nil {
			mod(c)
		}
		return c
	}

	email, err := auth.verify(context.Background(), signToken(t, key, "k1", claims(nil)))
	if err != nil || email != "owner@example.com" {
		t.Fatalf("valid token: email = %q, err = %v", email, err)
	}

	bad := map[string]string{
		"wrong audience": signToken(t, key, "k1", claims(func(c map[string]any) { c["aud"] = "other" })),
		"wrong issuer":   signToken(t, key, "k1", claims(func(c map[string]any) { c["iss"] = "evil" })),
		"expired":        signToken(t, key, "k1", claims(func(c map[string]any) { c["exp"] = now.Unix() - 600 })),
		"no email":       signToken(t, key, "k1", claims(func(c map[string]any) { delete(c, "email") })),
		"wrong key":      signToken(t, other, "k1", claims(nil)),
		"unknown kid":    signToken(t, key, "k2", claims(nil)),
		"garbage":        "a.b.c",
	}
	for name, token := range bad {
		if _, err := auth.verify(context.Background(), token); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}
