import { type ActivityStats, useApi } from "../api";
import { count, dateTime, percent } from "../format";
import { MiniLine } from "./charts";
import { type Period, periodLabel, periodQuery } from "./PeriodBar";

const METRICS = [
  { key: "dau", name: "DAU", note: "그날 앱을 쓴 사람" },
  { key: "mau", name: "MAU", note: "최근 30일 안에 쓴 사람" },
  { key: "total_users", name: "가입자 누적", note: "테스트·탈퇴 계정 제외" },
  { key: "new_users", name: "신규 가입", note: "그날 가입" },
] as const;

/** 오픈콜 DAU·MAU·가입자 누적과 기간별 추이. */
export default function ActivityCard({ period }: { period: Period }) {
  const stats = useApi<ActivityStats>(`/api/opencall/activity?${periodQuery(period)}`);
  const data = stats.data;
  const notConfigured = stats.error?.code === "not_configured";
  const labels = data ? data.series.map((p) => periodLabel(p.period, data.unit)) : [];
  const unitNote = data && data.unit !== "day" ? " (DAU 는 하루 평균, 신규 가입은 기간 합)" : "";

  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2>이용자</h2>
          {data && <p className="sub muted">{dateTime(data.updated_at)} 기준 · 5분마다 다시 계산</p>}
        </div>
      </header>

      {stats.loading && <p className="muted">불러오는 중…</p>}
      {!stats.loading && notConfigured && <p className="notice">오픈콜 관리자 API 가 아직 연결되지 않았습니다.</p>}
      {!stats.loading && stats.error && !notConfigured && <p className="notice error">{stats.error.message}</p>}

      {!stats.loading && data && (
        <>
          <dl className="facts">
            {METRICS.map((m) => (
              <div key={m.key}>
                <dt>{m.name}</dt>
                <dd className="big">{count(data.latest[m.key])}</dd>
              </div>
            ))}
            <div>
              <dt>DAU / MAU</dt>
              <dd className="big">{percent(data.latest.dau, data.latest.mau)}</dd>
            </div>
          </dl>
          <p className="muted small">
            숫자는 조회 기간 마지막 날 기준입니다{unitNote}. DAU 는 그날 앱을 쓴 사람, MAU 는 최근 30일 안에 쓴 사람이고
            마지막 접속 시각으로 셉니다. 가입자 누적은 테스트·탈퇴 계정을 뺀 수입니다.
          </p>
          <div className="multiples">
            {METRICS.map((m) => (
              <MiniLine
                key={m.key}
                title={m.name}
                color="var(--series-1)"
                format={count}
                points={data.series.map((p, i) => ({ label: labels[i], value: p[m.key] }))}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
