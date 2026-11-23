import { type ConversionReason, type SavedTierUsage, type UsageStats, type UsageTier, useApi } from "../api";
import { count, dateTime, percent } from "../format";
import { MiniLine } from "./charts";
import { type Period, periodLabel, periodQuery } from "./PeriodBar";

const USAGE_TIERS: { id: UsageTier | "all"; name: string }[] = [
  { id: "all", name: "전체" },
  { id: "guest", name: "무료" },
  { id: "regular", name: "정기" },
  { id: "premium", name: "프리미엄" },
];

const STATUS_NAMES: Record<string, string> = {
  contacted: "연락함",
  dealing: "거래 중",
  hold: "보류",
  todo: "연락 전으로 되돌림",
};

const SOURCE_NAMES: Record<string, string> = {
  store: "매장 상세",
  building: "새 상가 건물",
  closed: "폐업한 자리",
  saved: "보관함",
  web: "PC 웹",
};

const APP_NAMES: Record<string, string> = { naver: "네이버지도", kakao: "카카오맵", web: "웹 지도", "": "알 수 없음" };

const REASONS: Record<ConversionReason, { name: string; note: string }> = {
  delay: { name: "3일 늦게 보기", note: "“늦게 보여요” 띠에서 요금제를 누름" },
  region: { name: "지역 제한", note: "동 1개·30일에 1번 교체에 막힘, 지역 고르기에서 요금제를 누름" },
  saved_limit: { name: "보관함 10개", note: "무료 보관함이 다 참" },
  locked_info: { name: "가린 정보", note: "아파트 세대 수·통계 잠금에서 요금제를 누름" },
  other: { name: "일반 안내", note: "홈·목록 끝 안내 카드, 내 정보의 요금제 버튼" },
  none: { name: "기록 없음", note: "구독 전 30일 동안 걸린 제한·누른 버튼이 없음" },
};

function name(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

/** 오픈콜 앱 사용: 보관함 사용률 · 지도 열기 · 무료가 유료로 넘어가는 시점과 이유. */
export default function UsageCard({ period }: { period: Period }) {
  const stats = useApi<UsageStats>(`/api/opencall/usage?${periodQuery(period)}`);
  const data = stats.data;
  const notConfigured = stats.error?.code === "not_configured";

  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2>앱 사용</h2>
          {data && <p className="sub muted">마지막 기록 {dateTime(data.updated_at)} · 5분마다 반영</p>}
        </div>
      </header>

      {stats.loading && <p className="muted">불러오는 중…</p>}
      {!stats.loading && notConfigured && <p className="notice">오픈콜 관리자 API 가 아직 연결되지 않았습니다.</p>}
      {!stats.loading && stats.error && !notConfigured && <p className="notice error">{stats.error.message}</p>}

      {!stats.loading && data && (
        <>
          <Saved data={data} />
          <Maps data={data} />
          <Conversion data={data} />
        </>
      )}
    </section>
  );
}

function Saved({ data }: { data: UsageStats }) {
  const s = data.saved;
  const row = (id: UsageTier | "all"): SavedTierUsage => (id === "all" ? s.all : s.by_tier[id]);
  const statuses = Object.entries(s.status_to).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <div className="card-subhead">
        <h3>보관함 — 실제 영업에 쓰는가</h3>
      </div>
      <dl className="facts">
        <div>
          <dt>앱을 쓴 사람</dt>
          <dd className="big">{count(s.all.active_users)}</dd>
        </div>
        <div>
          <dt>보관함에 담은 사람</dt>
          <dd className="big">{percent(s.all.saver_users, s.all.active_users)}</dd>
        </div>
        <div>
          <dt>상태를 바꾼 사람</dt>
          <dd className="big">{percent(s.all.status_users, s.all.active_users)}</dd>
        </div>
        <div>
          <dt>담은 사람 중 상태까지 바꾼 사람</dt>
          <dd className="big">{percent(s.all.status_users, s.all.saver_users)}</dd>
        </div>
      </dl>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>등급</th>
              <th className="num">앱을 쓴 사람</th>
              <th className="num">담은 사람</th>
              <th className="num">비율</th>
              <th className="num">상태 바꾼 사람</th>
              <th className="num">비율</th>
              <th className="num">담은 횟수</th>
              <th className="num">상태 바꾼 횟수</th>
            </tr>
          </thead>
          <tbody>
            {USAGE_TIERS.map((t) => {
              const v = row(t.id);
              return (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="num">{count(v.active_users)}</td>
                  <td className="num">{count(v.saver_users)}</td>
                  <td className="num">{percent(v.saver_users, v.active_users)}</td>
                  <td className="num">{count(v.status_users)}</td>
                  <td className="num">{percent(v.status_users, v.active_users)}</td>
                  <td className="num">{count(v.adds)}</td>
                  <td className="num">{count(v.status_changes)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        조회 기간 안에 한 번이라도 한 사람을 셉니다. 담기만 하고 상태를 안 바꾸면 찜으로만 쓰는 것입니다.
        {statuses.length > 0 &&
          ` 바꾼 상태: ${statuses.map(([k, n]) => `${name(STATUS_NAMES, k)} ${count(n)}번`).join(" · ")}`}
      </p>
    </>
  );
}

function Maps({ data }: { data: UsageStats }) {
  const m = data.map;
  const labels = m.series.map((p) => periodLabel(p.period, data.unit));
  return (
    <>
      <div className="card-subhead">
        <h3>지도 열기 — 방문으로 이어지는가</h3>
      </div>
      <dl className="facts">
        <div>
          <dt>매장 상세를 연 횟수</dt>
          <dd className="big">{count(m.store_views)}</dd>
        </div>
        <div>
          <dt>지도를 연 횟수</dt>
          <dd className="big">{count(m.map_opens)}</dd>
        </div>
        <div>
          <dt>상세 → 지도</dt>
          <dd className="big">{percent(m.map_opens, m.store_views)}</dd>
        </div>
        <div>
          <dt>지도를 연 사람</dt>
          <dd className="big">
            {count(m.map_users)}
            <small> / {count(m.view_users)}명</small>
          </dd>
        </div>
      </dl>
      {m.series.length > 0 && (
        <div className="multiples">
          <MiniLine
            title="매장 상세"
            color="var(--series-1)"
            format={count}
            points={m.series.map((p, i) => ({ label: labels[i], value: p.store_views }))}
          />
          <MiniLine
            title="지도 열기"
            color="var(--series-1)"
            format={count}
            points={m.series.map((p, i) => ({ label: labels[i], value: p.map_opens }))}
          />
        </div>
      )}
      {m.map_opens > 0 && (
        <p className="muted small">
          누른 자리: {m.by_source.map((r) => `${name(SOURCE_NAMES, r.key)} ${count(r.count)}`).join(" · ")} / 열린 지도:{" "}
          {m.by_app.map((r) => `${name(APP_NAMES, r.key)} ${count(r.count)}`).join(" · ")}
        </p>
      )}
      <p className="muted small">
        앱에는 길찾기 버튼이 따로 없고, 주소를 누르면 지도 앱(네이버지도 → 카카오맵 → 웹)이 열립니다. 그 횟수입니다.
      </p>
    </>
  );
}

function Conversion({ data }: { data: UsageStats }) {
  const c = data.conversion;
  return (
    <>
      <div className="card-subhead">
        <h3>무료 → 유료 — 언제, 무엇 때문에</h3>
      </div>
      <dl className="facts">
        <div>
          <dt>무료로 쓴 사람</dt>
          <dd className="big">{count(c.guest_users)}</dd>
        </div>
        <div>
          <dt>처음 구독한 사람</dt>
          <dd className="big">{count(c.converted)}</dd>
        </div>
        <div>
          <dt>그중 무료 체험으로 시작</dt>
          <dd className="big">{count(c.trial)}</dd>
        </div>
        <div>
          <dt>가입부터 구독까지 (중앙값)</dt>
          <dd className="big">{c.median_days === null ? "-" : `${c.median_days.toLocaleString("ko-KR")}일`}</dd>
        </div>
      </dl>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>가입 뒤</th>
              {c.days.map((d) => (
                <th key={d.label} className="num">
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>구독한 사람</td>
              {c.days.map((d) => (
                <td key={d.label} className="num">
                  {count(d.count)}
                  <span className="muted"> ({percent(d.count, c.converted)})</span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>구독 전에 걸린 것</th>
              <th className="num">마지막으로 걸림</th>
              <th className="num">비율</th>
              <th className="num">한 번이라도 걸림</th>
              <th className="num">걸린 무료 이용자</th>
              <th className="num">그중 구독</th>
              <th className="num">구독으로 이어진 비율</th>
            </tr>
          </thead>
          <tbody>
            {c.reasons.map((r) => (
              <tr key={r.reason}>
                <td>
                  {REASONS[r.reason]?.name ?? r.reason}
                  <div className="muted small">{REASONS[r.reason]?.note}</div>
                </td>
                <td className="num">{count(r.last_touch)}</td>
                <td className="num">{percent(r.last_touch, c.converted)}</td>
                <td className="num">{count(r.any_touch)}</td>
                <td className="num">{r.reason === "none" ? "-" : count(r.guests)}</td>
                <td className="num">{r.reason === "none" ? "-" : count(r.converted)}</td>
                <td className="num">{r.reason === "none" ? "-" : percent(r.converted, r.guests)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        “마지막으로 걸림”은 구독하기 전 30일 안에 무료 상태에서 마지막으로 막힌 제한(또는 누른 요금제 버튼)입니다. 3일 늦게 보기가
        많으면 지연이, 지역 제한이 많으면 동 1개가 구독을 끌어낸 것입니다. 가입 0~3일 안의 구독은 지연을 겪기 전이라 지연 때문으로
        보기 어렵습니다. 스토어 구독만 세고(무료 체험 시작 포함), 프리미엄 상담 계약과 무료 명단은 넣지 않습니다. 기록은 이 기능을
        넣은 날부터 쌓입니다.
      </p>
    </>
  );
}
