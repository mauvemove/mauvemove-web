package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	iapHeader  = "X-Goog-Iap-Jwt-Assertion"
	iapIssuer  = "https://cloud.google.com/iap"
	iapKeysURL = "https://www.gstatic.com/iap/verify/public_key-jwk"
	clockSkew  = 30 * time.Second
)

type authenticator interface {
	name() string
	// authenticate 요청한 사람의 이메일을 돌려준다.
	authenticate(r *http.Request) (string, error)
}

func newAuthenticator(cfg config) (authenticator, error) {
	if cfg.IAPAudience != "" {
		return &iapAuth{
			audience: cfg.IAPAudience,
			keysURL:  iapKeysURL,
			client:   &http.Client{Timeout: 5 * time.Second},
			now:      time.Now,
		}, nil
	}
	if cfg.DevUserEmail != "" {
		return devAuth{email: cfg.DevUserEmail}, nil
	}
	return nil, errors.New("no authenticator configured")
}

// devAuth 로컬 개발용. 모든 요청을 정해진 사용자로 본다.
type devAuth struct{ email string }

func (d devAuth) name() string                               { return "dev (" + d.email + ")" }
func (d devAuth) authenticate(*http.Request) (string, error) { return d.email, nil }

// iapAuth IAP 가 붙여 주는 서명된 헤더를 검증한다.
// 헤더의 이메일 값만 믿으면 IAP 를 거치지 않은 요청이 사칭할 수 있어 서명을 확인한다.
type iapAuth struct {
	audience string
	keysURL  string
	client   *http.Client
	now      func() time.Time

	mu      sync.Mutex
	keys    map[string]*ecdsa.PublicKey
	fetched time.Time
}

func (a *iapAuth) name() string { return "iap" }

func (a *iapAuth) authenticate(r *http.Request) (string, error) {
	token := r.Header.Get(iapHeader)
	if token == "" {
		return "", errors.New("missing IAP assertion")
	}
	return a.verify(r.Context(), token)
}

func (a *iapAuth) verify(ctx context.Context, token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", errors.New("malformed token")
	}

	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := decodeSegment(parts[0], &header); err != nil {
		return "", fmt.Errorf("header: %w", err)
	}
	if header.Alg != "ES256" {
		return "", fmt.Errorf("unexpected alg %q", header.Alg)
	}

	key, err := a.key(ctx, header.Kid)
	if err != nil {
		return "", err
	}

	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(sig) != 64 {
		return "", errors.New("malformed signature")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	r := new(big.Int).SetBytes(sig[:32])
	s := new(big.Int).SetBytes(sig[32:])
	if !ecdsa.Verify(key, digest[:], r, s) {
		return "", errors.New("invalid signature")
	}

	var claims struct {
		Iss   string `json:"iss"`
		Aud   string `json:"aud"`
		Exp   int64  `json:"exp"`
		Iat   int64  `json:"iat"`
		Email string `json:"email"`
	}
	if err := decodeSegment(parts[1], &claims); err != nil {
		return "", fmt.Errorf("claims: %w", err)
	}

	now := a.now()
	switch {
	case claims.Iss != iapIssuer:
		return "", errors.New("unexpected issuer")
	case claims.Aud != a.audience:
		return "", errors.New("unexpected audience")
	case claims.Exp == 0 || now.After(time.Unix(claims.Exp, 0).Add(clockSkew)):
		return "", errors.New("token expired")
	case claims.Iat != 0 && now.Before(time.Unix(claims.Iat, 0).Add(-clockSkew)):
		return "", errors.New("token issued in the future")
	case claims.Email == "":
		return "", errors.New("token has no email")
	}
	return claims.Email, nil
}

// key 서명 키를 찾는다. 모르는 kid 면 키 목록을 다시 받되, 1분에 한 번만 받는다.
func (a *iapAuth) key(ctx context.Context, kid string) (*ecdsa.PublicKey, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if k, ok := a.keys[kid]; ok {
		return k, nil
	}
	if !a.fetched.IsZero() && a.now().Sub(a.fetched) < time.Minute {
		return nil, fmt.Errorf("unknown key id %q", kid)
	}

	keys, err := a.fetchKeys(ctx)
	if err != nil {
		return nil, fmt.Errorf("fetch IAP keys: %w", err)
	}
	a.keys = keys
	a.fetched = a.now()

	if k, ok := keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("unknown key id %q", kid)
}

func (a *iapAuth) fetchKeys(ctx context.Context) (map[string]*ecdsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.keysURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	var doc struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			Crv string `json:"crv"`
			X   string `json:"x"`
			Y   string `json:"y"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return nil, err
	}

	keys := make(map[string]*ecdsa.PublicKey, len(doc.Keys))
	for _, k := range doc.Keys {
		if k.Kty != "EC" || k.Crv != "P-256" {
			continue
		}
		x, errX := base64.RawURLEncoding.DecodeString(k.X)
		y, errY := base64.RawURLEncoding.DecodeString(k.Y)
		if errX != nil || errY != nil {
			continue
		}
		pub := &ecdsa.PublicKey{
			Curve: elliptic.P256(),
			X:     new(big.Int).SetBytes(x),
			Y:     new(big.Int).SetBytes(y),
		}
		if !pub.Curve.IsOnCurve(pub.X, pub.Y) {
			continue
		}
		keys[k.Kid] = pub
	}
	if len(keys) == 0 {
		return nil, errors.New("no usable keys")
	}
	return keys, nil
}

func decodeSegment(seg string, out any) error {
	raw, err := base64.RawURLEncoding.DecodeString(seg)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, out)
}

type userKey struct{}

func userEmail(ctx context.Context) string {
	email, _ := ctx.Value(userKey{}).(string)
	return email
}

// requireUser 인증에 실패한 요청을 막는다. 화면 파일을 포함해 모든 경로에 건다.
func requireUser(auth authenticator, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		email, err := auth.authenticate(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "로그인이 필요합니다.")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, email)))
	})
}
