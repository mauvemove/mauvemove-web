package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// 문의·추천인 코드 화면 (DW 2026-11-25). 오픈콜 쪽 API 는 opencall-server docs/CONTACT.md, docs/REFERRAL.md.
//
// 이 API 들은 통계 API 와 달리 오픈콜 공통 봉투 {"code","message","data"} 로 답한다.
// BFF 가 data 만 꺼내 돌려주므로 화면은 다른 카드와 같이 본문을 바로 쓴다.

const (
	maxAnswerRunes = 5000 // 오픈콜 contact.MaxAnswerRunes 와 같다
	maxWriteBody   = 64 << 10
)

var (
	contactStatuses = map[string]bool{"open": true, "answered": true, "closed": true}
	slugPattern     = regexp.MustCompile(`^[a-z0-9_]{1,20}$`)
	referralPattern = regexp.MustCompile(`^[a-z0-9]{1,10}$`)
)

// upstreamError 는 백엔드가 200 이 아닌 상태로 답한 것이다. 4xx 는 화면에 그 뜻을 알려 준다.
type upstreamError struct {
	status  int
	message string
}

func (e *upstreamError) Error() string { return fmt.Sprintf("HTTP %d %s", e.status, e.message) }

// handleOpencallContacts GET /api/opencall/contacts?status=&category=&limit=&offset=
func (s *server) handleOpencallContacts(w http.ResponseWriter, r *http.Request) {
	in := r.URL.Query()
	q := url.Values{}
	if v := in.Get("status"); v != "" {
		if !contactStatuses[v] {
			writeError(w, http.StatusBadRequest, "bad_request", "status 는 open, answered, closed 중 하나여야 합니다.")
			return
		}
		q.Set("status", v)
	}
	if v := in.Get("category"); v != "" {
		if !slugPattern.MatchString(v) {
			writeError(w, http.StatusBadRequest, "bad_request", "category 값이 올바르지 않습니다.")
			return
		}
		q.Set("category", v)
	}
	for key, max := range map[string]int{"limit": 200, "offset": 1_000_000} {
		if v := in.Get(key); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 || n > max {
				writeError(w, http.StatusBadRequest, "bad_request", key+" 값이 올바르지 않습니다.")
				return
			}
			q.Set(key, v)
		}
	}
	s.callOpencall(w, r, http.MethodGet, "/api/admin/contacts", q, nil, "문의 목록")
}

// handleOpencallContact GET /api/opencall/contacts/{id}
func (s *server) handleOpencallContact(w http.ResponseWriter, r *http.Request) {
	id, ok := contactID(w, r)
	if !ok {
		return
	}
	s.callOpencall(w, r, http.MethodGet, "/api/admin/contacts/"+id, nil, nil, "문의")
}

// handleOpencallContactReply POST /api/opencall/contacts/{id}/reply {"answer"} → {item, push_sent, mail_sent}
func (s *server) handleOpencallContactReply(w http.ResponseWriter, r *http.Request) {
	id, ok := contactID(w, r)
	if !ok {
		return
	}
	var in struct {
		Answer string `json:"answer"`
	}
	if !readJSONBody(w, r, &in) {
		return
	}
	answer := strings.TrimSpace(in.Answer)
	if answer == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "답변을 적어 주세요.")
		return
	}
	if utf8.RuneCountInString(answer) > maxAnswerRunes {
		writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("답변은 %d자까지 쓸 수 있습니다.", maxAnswerRunes))
		return
	}
	s.callOpencall(w, r, http.MethodPost, "/api/admin/contacts/"+id+"/reply", nil, map[string]string{"answer": answer}, "답변 보내기 결과")
}

// handleOpencallContactStatus PATCH /api/opencall/contacts/{id} {"status"}: 닫기·다시 열기.
func (s *server) handleOpencallContactStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := contactID(w, r)
	if !ok {
		return
	}
	var in struct {
		Status string `json:"status"`
	}
	if !readJSONBody(w, r, &in) {
		return
	}
	if !contactStatuses[in.Status] {
		writeError(w, http.StatusBadRequest, "bad_request", "status 는 open, answered, closed 중 하나여야 합니다.")
		return
	}
	s.callOpencall(w, r, http.MethodPatch, "/api/admin/contacts/"+id, nil, map[string]string{"status": in.Status}, "상태 변경 결과")
}

// handleOpencallReferrals GET /api/opencall/referrals?code=&limit=
func (s *server) handleOpencallReferrals(w http.ResponseWriter, r *http.Request) {
	in := r.URL.Query()
	q := url.Values{}
	if v := strings.ToLower(strings.TrimSpace(in.Get("code"))); v != "" {
		if !referralPattern.MatchString(v) {
			writeError(w, http.StatusBadRequest, "bad_request", "추천 코드는 영문 소문자·숫자 1~10자입니다.")
			return
		}
		q.Set("code", v)
	}
	if v := in.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 500 {
			writeError(w, http.StatusBadRequest, "bad_request", "limit 은 1~500 사이 숫자여야 합니다.")
			return
		}
		q.Set("limit", v)
	}
	s.callOpencall(w, r, http.MethodGet, "/api/admin/referrals", q, nil, "추천 코드 현황")
}

func contactID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if n, err := strconv.ParseInt(id, 10, 64); err != nil || n <= 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "문의 번호가 올바르지 않습니다.")
		return "", false
	}
	return id, true
}

// readJSONBody 는 바꾸는 요청의 본문을 읽는다. Content-Type 이 JSON 이어야 한다:
// 다른 사이트의 폼이 IAP 쿠키를 싣고 보내는 요청(CSRF)은 이 헤더를 붙일 수 없다.
func readJSONBody(w http.ResponseWriter, r *http.Request, out any) bool {
	mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mt != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "bad_request", "Content-Type 은 application/json 이어야 합니다.")
		return false
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxWriteBody)).Decode(out); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "요청 본문이 올바른 JSON 이 아닙니다.")
		return false
	}
	return true
}

// callOpencall 은 오픈콜 관리자 API 를 백오피스 인증으로 부르고, 봉투의 data 만 돌려준다.
// 오픈콜이 4xx 로 답하면 같은 상태로 화면에 알린다 (없는 문의, 잘못된 값 등).
func (s *server) callOpencall(w http.ResponseWriter, r *http.Request, method, path string, q url.Values, body any, what string) {
	if s.opencallToken == nil {
		writeError(w, http.StatusServiceUnavailable, "not_configured", "오픈콜 관리자 API 가 아직 연결되지 않았습니다.")
		return
	}
	token, err := s.opencallToken.token(r.Context())
	if err != nil {
		log.Printf("opencall id token: %v", err)
		writeError(w, http.StatusBadGateway, "upstream_auth", "오픈콜 호출용 인증 토큰을 받지 못했습니다.")
		return
	}

	svc, _ := s.cfg.service("opencall")
	target := svc.APIURL + path
	if len(q) > 0 {
		target += "?" + q.Encode()
	}
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	err = s.sendJSON(r.Context(), method, target, token, body, &env)
	var ue *upstreamError
	switch {
	case errors.As(err, &ue) && ue.status == http.StatusNotFound:
		writeError(w, http.StatusNotFound, "not_found", "오픈콜 서버에 없는 항목이거나, 아직 이 기능이 배포되지 않았습니다.")
		return
	case errors.As(err, &ue) && ue.status >= 400 && ue.status < 500 && ue.status != http.StatusUnauthorized && ue.status != http.StatusForbidden:
		writeError(w, ue.status, "upstream_rejected", "오픈콜 서버가 요청을 받지 않았습니다: "+ue.message)
		return
	case err != nil:
		log.Printf("opencall %s %s: %v", method, path, err)
		writeError(w, http.StatusBadGateway, "upstream_error", "오픈콜 서버에서 "+what+"를 가져오지 못했습니다.")
		return
	}
	if len(env.Data) == 0 {
		env.Data = json.RawMessage("null")
	}
	writeJSON(w, http.StatusOK, env.Data)
}

// sendJSON 은 백엔드를 method 로 부르고(body 가 있으면 JSON 으로 실어) JSON 응답을 out 에 담는다.
func (s *server) sendJSON(ctx context.Context, method, target, bearer string, body any, out any) error {
	ctx, cancel := context.WithTimeout(ctx, upstreamTimeout)
	defer cancel()

	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
		if email := userEmail(ctx); email != "" {
			req.Header.Set(adminUserHeader, email)
		}
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("연결 실패: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxUpstreamBody))
	if err != nil {
		return fmt.Errorf("응답 읽기 실패: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &e)
		return &upstreamError{status: resp.StatusCode, message: e.Message}
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("JSON 이 아닌 응답: %w", err)
	}
	return nil
}
