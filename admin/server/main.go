// 통합 백오피스 BFF.
//
// 브라우저는 이 서버만 부른다. 이 서버가 각 서비스 백엔드를 대신 호출하고,
// 빌드된 화면(web/dist)도 같이 내려준다.
package main

import (
	"log"
	"net/http"
	"time"
)

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	auth, err := newAuthenticator(cfg)
	if err != nil {
		log.Fatalf("auth: %v", err)
	}

	srv := newServer(cfg, auth)
	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("admin server listening on :%s (auth: %s)", cfg.Port, auth.name())
	log.Fatal(httpSrv.ListenAndServe())
}
