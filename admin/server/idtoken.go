package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// metadataIdentityURL Cloud Run 메타데이터 서버의 ID 토큰 발급 주소.
const metadataIdentityURL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity"

// tokenRefreshMargin 만료 이만큼 전에 새 토큰을 받는다.
const tokenRefreshMargin = 5 * time.Minute

// tokenSource 백엔드 관리자 API 에 붙일 Bearer 토큰을 준다.
type tokenSource interface {
	token(ctx context.Context) (string, error)
}

// staticToken 로컬 개발용 고정 토큰 (예: gcloud auth print-identity-token 결과).
type staticToken string

func (t staticToken) token(context.Context) (string, error) { return string(t), nil }

// metadataToken Cloud Run 서비스 계정의 Google ID 토큰을 메타데이터 서버에서 받아 캐시한다.
// 받는 쪽 백엔드는 서명(Google), aud, email(이 서비스 계정)을 검증한다.
type metadataToken struct {
	audience string
	url      string
	client   *http.Client
	now      func() time.Time

	mu  sync.Mutex
	tok string
	exp time.Time
}

func newMetadataToken(audience string) *metadataToken {
	return &metadataToken{
		audience: audience,
		url:      metadataIdentityURL,
		client:   &http.Client{Timeout: 5 * time.Second},
		now:      time.Now,
	}
}

func (m *metadataToken) token(ctx context.Context) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.tok != "" && m.now().Before(m.exp.Add(-tokenRefreshMargin)) {
		return m.tok, nil
	}

	q := url.Values{"audience": {m.audience}, "format": {"full"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.url+"?"+q.Encode(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Metadata-Flavor", "Google")
	resp, err := m.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("메타데이터 서버 연결 실패: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 16<<10))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("메타데이터 서버 HTTP %d", resp.StatusCode)
	}

	tok := strings.TrimSpace(string(raw))
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return "", errors.New("메타데이터 서버가 JWT 가 아닌 값을 돌려줬다")
	}
	// 서명 검증은 받는 쪽 몫이다. 여기서는 캐시 기간을 정하려고 exp 만 읽는다.
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := decodeSegment(parts[1], &claims); err != nil || claims.Exp == 0 {
		return "", errors.New("ID 토큰에 exp 가 없다")
	}

	m.tok, m.exp = tok, time.Unix(claims.Exp, 0)
	return m.tok, nil
}
