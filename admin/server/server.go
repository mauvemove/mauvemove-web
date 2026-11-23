package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// Cloudflare 봇 차단이 Go 기본 User-Agent 를 403 으로 막는다. 이름을 밝힌다.
	userAgent       = "mauvemove-admin/0.1"
	upstreamTimeout = 8 * time.Second
	maxUpstreamBody = 2 << 20
)

// adminUserHeader 백엔드 관리자 API 에 실제로 요청한 관리자의 이메일을 알린다 (감사 로그·권한 확인용).
// 이 값은 BFF 가 IAP 서명을 검증한 뒤에 붙이므로, 백엔드는 ID 토큰을 검증한 요청에서만 믿는다.
const adminUserHeader = "X-Admin-User-Email"

type server struct {
	cfg    config
	auth   authenticator
	client *http.Client
	// opencallToken 이 nil 이면 오픈콜 관리자 API 가 연결되지 않은 것이다.
	opencallToken tokenSource
}

func newServer(cfg config, auth authenticator) *server {
	s := &server{cfg: cfg, auth: auth, client: &http.Client{Timeout: upstreamTimeout}}
	switch {
	case cfg.OpencallAudience != "":
		s.opencallToken = newMetadataToken(cfg.OpencallAudience)
	case cfg.OpencallAdminToken != "":
		s.opencallToken = staticToken(cfg.OpencallAdminToken)
	}
	return s
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("GET /api/services", s.handleServices)
	mux.HandleFunc("GET /api/nongolbus/notices", s.handleNongolbusNotices)
	mux.HandleFunc("GET /api/opencall/ads/stats", s.handleOpencallAdsStats)
	mux.HandleFunc("GET /api/opencall/tiers", s.handleOpencallPeriod("/api/admin/tiers", "등급별 통계"))
	mux.HandleFunc("GET /api/opencall/activity", s.handleOpencallPeriod("/api/admin/activity", "이용자 통계"))
	mux.HandleFunc("GET /api/opencall/usage", s.handleOpencallPeriod("/api/admin/usage", "앱 사용 통계"))
	mux.HandleFunc("GET /api/opencall/density", s.handleOpencallDensity)
	mux.HandleFunc("GET /api/opencall/jobs", s.handleOpencallPlain("/api/admin/jobs", "배치 상태"))
	mux.HandleFunc("GET /api/opencall/apis", s.handleOpencallPlain("/api/admin/apis", "수집 API 상태"))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "없는 API 입니다.")
	})
	// "/api/" 가 메서드 없이 등록돼 있어 여기도 메서드를 붙이지 않는다 ("GET /" 와는 충돌한다).
	mux.HandleFunc("/", s.handleStatic)
	return requireUser(s.auth, mux)
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"email": userEmail(r.Context())})
}

type serviceStatus struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	APIURL    string `json:"apiUrl"`
	OK        bool   `json:"ok"`
	Version   string `json:"version,omitempty"`
	Error     string `json:"error,omitempty"`
	LatencyMs int64  `json:"latencyMs"`
}

// handleServices 서비스 목록과 각 백엔드의 응답 여부·버전.
// 세 백엔드 모두 GET /api/version 이 {"data":{"version":"…"}} 를 돌려준다.
func (s *server) handleServices(w http.ResponseWriter, r *http.Request) {
	out := make([]serviceStatus, len(s.cfg.Services))
	var wg sync.WaitGroup
	for i, svc := range s.cfg.Services {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st := serviceStatus{ID: svc.ID, Name: svc.Name, APIURL: svc.APIURL}
			start := time.Now()
			var body struct {
				Data struct {
					Version string `json:"version"`
				} `json:"data"`
			}
			err := s.getJSON(r.Context(), svc.APIURL+"/api/version", "", &body)
			st.LatencyMs = time.Since(start).Milliseconds()
			if err != nil {
				st.Error = err.Error()
			} else {
				st.OK = true
				st.Version = body.Data.Version
			}
			out[i] = st
		}()
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, map[string]any{"services": out})
}

// handleNongolbusNotices 지금 앱에 나가고 있는 공지를 플랫폼별로 보여 준다.
// 논골버스는 DB 가 없고 공지가 서버 설정 파일에 있어서 여기서는 읽기만 한다.
func (s *server) handleNongolbusNotices(w http.ResponseWriter, r *http.Request) {
	svc, _ := s.cfg.service("nongolbus")
	out := map[string]json.RawMessage{}
	for _, platform := range []string{"android", "ios"} {
		var body struct {
			Notices json.RawMessage `json:"notices"`
		}
		if err := s.getJSON(r.Context(), svc.APIURL+"/api/notices?platform="+platform, "", &body); err != nil {
			log.Printf("nongolbus notices (%s): %v", platform, err)
			writeError(w, http.StatusBadGateway, "upstream_error", "논골버스 서버에서 공지를 가져오지 못했습니다.")
			return
		}
		if len(body.Notices) == 0 {
			body.Notices = json.RawMessage("[]")
		}
		out[platform] = body.Notices
	}
	writeJSON(w, http.StatusOK, out)
}

// handleOpencallAdsStats 오픈콜 GET /api/admin/ads/stats 를 대신 부른다.
func (s *server) handleOpencallAdsStats(w http.ResponseWriter, r *http.Request) {
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if !isDate(from) || !isDate(to) {
		writeError(w, http.StatusBadRequest, "bad_request", "from, to 는 YYYY-MM-DD 형식이어야 합니다.")
		return
	}
	s.proxyOpencall(w, r, "/api/admin/ads/stats", url.Values{"from": {from}, "to": {to}}, "광고 통계")
}

// handleOpencallPeriod 는 기간(from·to, 없으면 오픈콜 기본값)과 묶음 단위(unit)를 받는 오픈콜 통계 API 를 대신 부른다.
func (s *server) handleOpencallPeriod(path, what string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		in := r.URL.Query()
		q := url.Values{}
		for _, k := range []string{"from", "to"} {
			if v := in.Get(k); v != "" {
				if !isDate(v) {
					writeError(w, http.StatusBadRequest, "bad_request", "from, to 는 YYYY-MM-DD 형식이어야 합니다.")
					return
				}
				q.Set(k, v)
			}
		}
		switch unit := in.Get("unit"); unit {
		case "":
		case "day", "week", "month":
			q.Set("unit", unit)
		default:
			writeError(w, http.StatusBadRequest, "bad_request", "unit 은 day, week, month 중 하나여야 합니다.")
			return
		}
		s.proxyOpencall(w, r, path, q, what)
	}
}

// handleOpencallDensity 는 오픈콜 지역 밀도 통계를 대신 부른다. days(해지를 세는 기간)·crowded_min(몰림 기준)은 숫자만 넘긴다.
func (s *server) handleOpencallDensity(w http.ResponseWriter, r *http.Request) {
	in := r.URL.Query()
	q := url.Values{}
	for _, k := range []string{"days", "crowded_min"} {
		v := in.Get(k)
		if v == "" {
			continue
		}
		if n, err := strconv.Atoi(v); err != nil || n < 1 || n > 1000 {
			writeError(w, http.StatusBadRequest, "bad_request", "days, crowded_min 은 1 이상의 숫자여야 합니다.")
			return
		}
		q.Set(k, v)
	}
	s.proxyOpencall(w, r, "/api/admin/density", q, "지역 밀도 통계")
}

// handleOpencallPlain 은 쿼리 없는 오픈콜 관리자 GET API 를 대신 부른다.
func (s *server) handleOpencallPlain(path, what string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.proxyOpencall(w, r, path, nil, what)
	}
}

// proxyOpencall 은 오픈콜 관리자 API 를 백오피스 인증(ID 토큰 또는 로컬 토큰)으로 부르고 본문을 그대로 돌려준다.
func (s *server) proxyOpencall(w http.ResponseWriter, r *http.Request, path string, q url.Values, what string) {
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
	var body json.RawMessage
	if err := s.getJSON(r.Context(), target, token, &body); err != nil {
		log.Printf("opencall %s: %v", path, err)
		writeError(w, http.StatusBadGateway, "upstream_error", "오픈콜 서버에서 "+what+"를 가져오지 못했습니다.")
		return
	}
	writeJSON(w, http.StatusOK, body)
}

// handleStatic 빌드된 화면을 내려준다. 파일이 없는 경로는 index.html 로 보내 화면 쪽 라우터가 처리하게 한다.
func (s *server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "허용되지 않은 메서드입니다.")
		return
	}
	clean := path.Clean("/" + r.URL.Path)
	file := filepath.Join(s.cfg.StaticDir, filepath.FromSlash(clean))
	if info, err := os.Stat(file); err == nil && !info.IsDir() {
		if strings.HasPrefix(clean, "/assets/") {
			// 파일 이름에 해시가 들어 있어 오래 캐시해도 된다.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		http.ServeFile(w, r, file)
		return
	}

	index := filepath.Join(s.cfg.StaticDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		writeError(w, http.StatusNotFound, "not_built", "화면이 빌드되지 않았습니다. admin/web 에서 npm run build 를 실행하세요.")
		return
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, index)
}

// getJSON 백엔드를 GET 으로 부르고 JSON 응답을 out 에 담는다.
func (s *server) getJSON(ctx context.Context, target, bearer string, out any) error {
	ctx, cancel := context.WithTimeout(ctx, upstreamTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
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
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("JSON 이 아닌 응답: %w", err)
	}
	return nil
}

func isDate(v string) bool {
	_, err := time.Parse("2006-01-02", v)
	return err == nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}
