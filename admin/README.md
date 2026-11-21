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
| 오픈콜 (첫 화면) | 서버 상태, 등급별 현황(게스트·정기·프리미엄·무료 명단 인원·매출·누적), 이용자(DAU·MAU·가입자 누적), 배치 상태, 수집 API 상태, 광고 통계 | 통계는 오픈콜 관리자 API 연결(아래 "백엔드 관리자 API 인증")이 있어야 나온다. 오픈콜 쪽 계산 방식은 opencall-server `docs/BACKOFFICE_STATS.md` |
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
| `OPENCALL_ID_TOKEN_AUDIENCE` | 운영용. 오픈콜 `/api/admin/*` 를 부를 때 붙일 Google ID 토큰의 aud. 보통 `https://opencall-api.mauvemove.com` |
| `OPENCALL_ADMIN_TOKEN` | 로컬용. 메타데이터 서버 대신 쓸 고정 토큰. `OPENCALL_ID_TOKEN_AUDIENCE` 와 같이 쓸 수 없다 |
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

Cloud Build 가 배포까지 하려면 빌드에 쓰는 서비스 계정(지정하지 않으면 기본 compute 서비스 계정 `<프로젝트 번호>-compute@developer.gserviceaccount.com`)에 Cloud Run 관리자(`roles/run.admin`)와, 실행 서비스 계정 `mauvemove-admin@…` 에 대한 서비스 계정 사용자(`roles/iam.serviceAccountUser`) 권한이 있어야 한다. 이 권한이 없으면 테스트·빌드·push 는 되고 마지막 deploy 단계만 실패한다 (그때는 push 된 이미지로 `gcloud run deploy` 를 손으로 해도 된다).

처음 한 번은 손으로 한다.

1. Artifact Registry 저장소 만들기
2. Cloud Run 서비스를 만들고 환경 변수(`IAP_AUDIENCE`, `OPENCALL_ID_TOKEN_AUDIENCE` 등)를 건다. 이후 배포는 이미지만 바꾸므로 환경 변수는 유지된다
3. 서비스에 IAP 를 켜고 허용 계정을 넣는다. `IAP_AUDIENCE` 는 Cloud Run 에 IAP 를 직접 켜면 `/projects/<프로젝트 번호>/locations/<리전>/services/<서비스 이름>`, 부하 분산기를 거치면 `/projects/<프로젝트 번호>/global/backendServices/<백엔드 서비스 ID>` 형식이다
4. Cloudflare 에 `admin` 레코드 추가

PR 과 main 의 `admin/**` 변경은 GitHub Actions(`.github/workflows/admin.yml`)가 `go vet`/`go test`, `npm ci`/`npm run build` 를 돌린다.

## 백엔드 관리자 API 인증

BFF 는 Cloud Run 서비스 계정의 **Google ID 토큰**으로 각 백엔드의 관리자 API 를 부른다. 만료되는 사용자 토큰이나 공유 비밀을 쓰지 않는다.

BFF 가 보내는 것:

| 헤더 | 값 |
|---|---|
| `Authorization` | `Bearer <Google ID 토큰>`. 메타데이터 서버에서 받고, 만료 5분 전까지 캐시한다 |
| `X-Admin-User-Email` | 실제로 요청한 관리자의 이메일 (BFF 가 IAP 서명을 검증한 값). 감사 로그용 |

받는 쪽 백엔드(`/api/admin/*`)가 검증할 것:

1. 서명: Google 공개키(`https://www.googleapis.com/oauth2/v3/certs`)로 RS256 검증. Go 라면 `google.golang.org/api/idtoken` 의 `idtoken.Validate(ctx, token, audience)` 하나로 된다
2. `iss` 가 `https://accounts.google.com` 또는 `accounts.google.com`
3. `aud` 가 자기 주소 (BFF 의 `OPENCALL_ID_TOKEN_AUDIENCE` 와 같은 값)
4. `email` 이 백오피스 Cloud Run 서비스 계정이고 `email_verified` 가 true
5. 통과한 요청에서만 `X-Admin-User-Email` 을 믿고 로그에 남긴다. 토큰 검증 없이 이 헤더만 보고 처리하면 안 된다

로컬에서 오픈콜 관리자 API 를 붙여 보려면 서비스 계정을 가장해 토큰을 받는다.

```bash
OPENCALL_ADMIN_TOKEN=$(gcloud auth print-identity-token \
  --impersonate-service-account=<백오피스 서비스 계정> \
  --audiences=https://opencall-api.mauvemove.com --include-email)
```

## 남은 일

- 오픈콜 서버에 아래 "백엔드 관리자 API 인증" 검증을 넣는다 (오픈콜 repo 작업). 지금 오픈콜 `/api/admin/*` 는 ADMIN 사용자 토큰만 받는다.
- 오픈콜 화면 추가: 유저 목록·통계는 오픈콜 서버에 조회 API 가 먼저 있어야 한다.
- 배포 실행: Cloud Run 서비스·IAP·Cloud Build 트리거 생성, `admin.mauvemove.com` DNS.
