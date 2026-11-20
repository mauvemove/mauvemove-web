package main

import (
	"errors"
	"os"
	"strings"
)

// service 백오피스가 다루는 서비스 하나.
type service struct {
	ID     string
	Name   string
	APIURL string
}

type config struct {
	Port      string
	StaticDir string

	// IAPAudience 가 있으면 IAP 서명을 검증한다. 운영에서는 반드시 설정한다.
	IAPAudience string
	// DevUserEmail 은 IAP 없이 로컬에서 띄울 때만 쓴다.
	DevUserEmail string

	Services []service

	// OpencallAdminToken 오픈콜 /api/admin/* 호출용 토큰. 없으면 해당 화면은 "연결 전"으로 나온다.
	OpencallAdminToken string
}

func loadConfig() (config, error) {
	cfg := config{
		Port:               env("PORT", "8080"),
		StaticDir:          env("STATIC_DIR", "../web/dist"),
		IAPAudience:        os.Getenv("IAP_AUDIENCE"),
		DevUserEmail:       os.Getenv("DEV_USER_EMAIL"),
		OpencallAdminToken: os.Getenv("OPENCALL_ADMIN_TOKEN"),
		// 화면에 나오는 순서다. 첫 번째가 첫 화면.
		Services: []service{
			{ID: "opencall", Name: "오픈콜", APIURL: envURL("OPENCALL_API_URL", "https://opencall.mauvemove.com")},
			{ID: "nongolbus", Name: "논골버스", APIURL: envURL("NONGOLBUS_API_URL", "https://api.nongolbus.mauvemove.com")},
			{ID: "lottosmash", Name: "로또스매시", APIURL: envURL("LOTTOSMASH_API_URL", "https://lottosmash.mauvemove.com")},
		},
	}

	// 인증 없이 뜨는 일이 없도록 둘 중 하나는 있어야 한다.
	if cfg.IAPAudience == "" && cfg.DevUserEmail == "" {
		return cfg, errors.New("IAP_AUDIENCE(운영) 또는 DEV_USER_EMAIL(로컬) 중 하나를 설정해야 한다")
	}
	if cfg.IAPAudience != "" && cfg.DevUserEmail != "" {
		return cfg, errors.New("IAP_AUDIENCE 와 DEV_USER_EMAIL 을 같이 설정할 수 없다")
	}
	return cfg, nil
}

func (c config) service(id string) (service, bool) {
	for _, s := range c.Services {
		if s.ID == id {
			return s, true
		}
	}
	return service{}, false
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envURL(key, fallback string) string {
	return strings.TrimRight(env(key, fallback), "/")
}
