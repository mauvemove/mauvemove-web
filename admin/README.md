# admin — 통합 백오피스

오픈콜·논골버스·로또스매시를 한 화면에서 보는 백오피스. 주소는 `https://admin.mauvemove.com` (Cloud Run + IAP, 아직 배포 전).

## 구조

| 경로 | 내용 |
|---|---|
| `server/` | Go BFF. 브라우저 대신 각 서비스 백엔드를 호출하고, 빌드된 화면도 내려준다. 외부 모듈 없이 표준 라이브러리만 쓴다 |
| `web/` | 화면. React + TypeScript + Vite |

브라우저는 BFF 의 `/api/*` 만 부른다. 백엔드 주소와 관리자 토큰은 BFF 에만 있다.

## 화면

| 서비스 | 지금 나오는 것 | 비고 |
|---|---|---|
| 오픈콜 (첫 화면) | 서버 상태, 광고 통계 | 통계는 `OPENCALL_ADMIN_TOKEN` 이 있어야 나온다 |
| 논골버스 | 서버 상태, 지금 앱에 나가는 공지 | 읽기 전용. 공지는 논골버스 서버 설정 파일에서 관리한다 (DB 없음) |
| 로또스매시 | 서버 상태 | |

## 빌드·테스트

```bash
cd admin/server && go vet ./... && go test ./...
cd ../web && npm ci && npm run build
```

## 로컬 실행

터미널 두 개를 쓴다.

```bash
# 1) BFF (8080)
cd admin/server
DEV_USER_EMAIL=me@example.com go run .

# 2) 화면 (5173, /api 는 8080 으로 넘긴다)
cd admin/web
npm run dev
```

## 환경 변수 (BFF)

| 이름 | 내용 |
|---|---|
| `IAP_AUDIENCE` | 운영용. IAP 가 붙이는 서명 헤더의 aud 값. 설정하면 모든 요청의 서명을 검증한다 |
| `DEV_USER_EMAIL` | 로컬용. IAP 없이 이 사용자로 본다. `IAP_AUDIENCE` 와 같이 쓸 수 없다 |
| `OPENCALL_ADMIN_TOKEN` | 오픈콜 `/api/admin/*` 호출용 토큰 |
| `OPENCALL_API_URL`, `NONGOLBUS_API_URL`, `LOTTOSMASH_API_URL` | 백엔드 주소. 기본값은 운영 주소 |
| `PORT` | 기본 8080 |
| `STATIC_DIR` | 빌드된 화면 위치. 기본 `../web/dist` |

`IAP_AUDIENCE` 와 `DEV_USER_EMAIL` 이 둘 다 없으면 서버가 뜨지 않는다 (인증 없이 열리는 것을 막는다).

## 배포

`Dockerfile` 하나로 화면과 BFF 를 같이 굽는다 (빌드 컨텍스트는 `admin/`).

```bash
docker build -t admin admin/
docker run -e DEV_USER_EMAIL=me@example.com -p 8080:8080 admin
```

운영 배포는 Cloud Build 트리거로 한다. 트리거에 포함 경로 필터 `admin/**`, 설정 파일 `admin/cloudbuild.yaml` 을 지정한다.
`cloudbuild.yaml` 은 테스트 → 이미지 빌드·푸시(Artifact Registry) → `gcloud run deploy` 순서이고, 리전·저장소·서비스 이름은 substitution(`_REGION`, `_REPOSITORY`, `_SERVICE`)으로 트리거에서 바꾼다.

처음 한 번은 손으로 한다.

1. Artifact Registry 저장소 만들기
2. Cloud Run 서비스를 만들고 환경 변수(`IAP_AUDIENCE`, `OPENCALL_ADMIN_TOKEN` 등)를 건다. 이후 배포는 이미지만 바꾸므로 환경 변수는 유지된다
3. 서비스에 IAP 를 켜고 허용 계정을 넣는다. `IAP_AUDIENCE` 는 Cloud Run 에 IAP 를 직접 켜면 `/projects/<프로젝트 번호>/locations/<리전>/services/<서비스 이름>`, 부하 분산기를 거치면 `/projects/<프로젝트 번호>/global/backendServices/<백엔드 서비스 ID>` 형식이다
4. Cloudflare 에 `admin` 레코드 추가

PR 과 main 의 `admin/**` 변경은 GitHub Actions(`.github/workflows/admin.yml`)가 `go vet`/`go test`, `npm ci`/`npm run build` 를 돌린다.

## 남은 일

- 오픈콜 관리자 인증: 지금 오픈콜 `/api/admin/*` 는 ADMIN 등급 사용자 토큰을 요구한다. 사용자 토큰은 만료되므로, BFF 가 쓸 서버 간 인증 방식을 오픈콜 서버에 정해야 한다.
- 오픈콜 화면 추가: 유저 목록·통계는 오픈콜 서버에 조회 API 가 먼저 있어야 한다.
- 배포 실행: Cloud Run 서비스·IAP·Cloud Build 트리거 생성, `admin.mauvemove.com` DNS.
