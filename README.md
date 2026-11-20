# mauvemove-web

MauveMove 서비스들의 웹페이지와 통합 백오피스를 담는 모노레포.

## 구조

| 경로 | 내용 | 주소 | 호스팅 |
|---|---|---|---|
| `sites/nongolbus/` | 논골버스 소개 페이지, 개인정보처리방침, app-ads.txt | https://nongolbus.mauvemove.com | Cloudflare Workers (정적 자산) |
| `sites/opencall/` | 오픈콜 웹 (미구현) | https://opencall.mauvemove.com | Cloudflare Workers 예정 |
| `admin/` | 3개 서비스 통합 백오피스 (미구현) | https://admin.mauvemove.com | Cloud Run + IAP |
| `shared/` | 공통 스타일·컴포넌트·개인정보처리방침 공통 문단 | - | - |

## 주소 규칙

- `<서비스>.mauvemove.com`: 사용자용 웹
- `<서비스>-api.mauvemove.com`: API. Cloudflare 무료 인증서가 한 단계 서브도메인만 지원하므로 `api.<서비스>` 형태는 쓰지 않는다.
- `admin.mauvemove.com`: 백오피스
- 예외
  - `api.nongolbus.mauvemove.com`: 출시된 앱이 사용 중. Firebase Hosting → Cloud Run.
  - 로또스매시는 개인 프로젝트라 이 repo에 넣지 않는다. 페이지(`www.lottosmash.mauvemove.com`)는 개인 계정 repo의 GitHub Pages, API(`lottosmash.mauvemove.com`)는 GCP VM에서 그대로 운영한다.

## 배포

정적 페이지는 Cloudflare Workers(정적 자산)로 배포한다. 사이트별로 Worker를 하나씩 만들고, 각 사이트 폴더의 `wrangler.jsonc`가 배포 설정이다.

| Worker 이름 | 루트 디렉터리 | 배포 명령 | 빌드 감시 경로 |
|---|---|---|---|
| nongolbus | `sites/nongolbus` | `npx wrangler deploy` | `sites/nongolbus/*` |
| opencall | `sites/opencall` | `npx wrangler deploy` | `sites/opencall/*` |

`main`에 병합하면 바로 운영에 배포된다. 예약 공개는 없으므로, 아직 공개하면 안 되는 내용은 `main`에 병합하지 않는다.

### 미리보기 빌드

`main`이 아닌 브랜치를 푸시하면 Cloudflare가 미리보기 빌드를 돌리고, 그 결과가 PR 체크(`Workers Builds: nongolbus`)로 표시된다.

- 미리보기 빌드는 대시보드의 루트 디렉터리 설정과 상관없이 repo 루트에서 `npx wrangler preview`로 실행된다. 그래서 루트에 `wrangler.jsonc`를 따로 둔다. 이 파일을 지우면 PR 체크가 실패한다.
- 운영 배포는 `sites/nongolbus/wrangler.jsonc`를 쓴다. 두 파일 모두 `previews` 블록이 있어야 한다.
- 루트 `wrangler.jsonc`는 Worker 하나(`nongolbus`)만 가리킬 수 있다. opencall Worker를 추가할 때는 미리보기 빌드를 어떻게 나눌지 다시 정해야 한다.

## 규칙

- 개인정보처리방침은 서비스별로 따로 둔다 (`<서비스 도메인>/privacy.html`).
- `app-ads.txt`는 해당 서비스 도메인 루트에 있어야 한다 (AdMob 확인용).
- 스토어에 등록된 주소(`/privacy.html`, `/app-ads.txt`)의 경로는 바꾸지 않는다.
