# mauvemove-web

MauveMove 서비스들의 웹페이지와 통합 백오피스를 담는 모노레포.

## 구조

| 경로 | 내용 | 주소 | 호스팅 |
|---|---|---|---|
| `sites/nongolbus/` | 논골버스 소개 페이지, 개인정보처리방침, app-ads.txt | https://nongolbus.mauvemove.com | Cloudflare Pages |
| `sites/lottosmash/` | 로또스매시 소개 페이지 (미이전, 현재 ethan509 계정 repo의 GitHub Pages) | https://www.lottosmash.mauvemove.com | Cloudflare Pages 예정 |
| `sites/opencall/` | 오픈콜 웹 (미구현) | https://opencall.mauvemove.com | Cloudflare Pages 예정 |
| `admin/` | 3개 서비스 통합 백오피스 (미구현) | https://admin.mauvemove.com | Cloud Run + IAP |
| `shared/` | 공통 스타일·컴포넌트·개인정보처리방침 공통 문단 | - | - |

## 주소 규칙

- `<서비스>.mauvemove.com`: 사용자용 웹
- `<서비스>-api.mauvemove.com`: API. Cloudflare 무료 인증서가 한 단계 서브도메인만 지원하므로 `api.<서비스>` 형태는 쓰지 않는다.
- `admin.mauvemove.com`: 백오피스
- 예외
  - `api.nongolbus.mauvemove.com`: 출시된 앱이 사용 중. Firebase Hosting → Cloud Run.
  - `lottosmash.mauvemove.com`(API), `www.lottosmash.mauvemove.com`(페이지): 출시된 앱과 스토어 등록 주소라 당분간 유지.

## 배포

정적 페이지는 Cloudflare Pages 프로젝트를 사이트별로 하나씩 만든다.

| 프로젝트 | 루트 디렉터리 | 빌드 명령 | 빌드 감시 경로 |
|---|---|---|---|
| nongolbus | `sites/nongolbus` | 없음 | `sites/nongolbus/*` |
| lottosmash | `sites/lottosmash` | 없음 | `sites/lottosmash/*` |
| opencall | `sites/opencall` | 없음 | `sites/opencall/*` |

## 규칙

- 개인정보처리방침은 서비스별로 따로 둔다 (`<서비스 도메인>/privacy.html`).
- `app-ads.txt`는 해당 서비스 도메인 루트에 있어야 한다 (AdMob 확인용).
- 스토어에 등록된 주소(`/privacy.html`, `/app-ads.txt`)의 경로는 바꾸지 않는다.
