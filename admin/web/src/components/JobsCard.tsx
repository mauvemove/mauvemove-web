import { type JobStatus, type JobsStatus, useApi } from "../api";
import { dateTime, duration } from "../format";

// 오픈콜 서버의 작업 이름 → 화면 이름. 모르는 이름은 그대로 보여 준다.
const JOB_NAMES: Record<string, string> = {
  localdata_sync: "인허가 수집",
  new_store_report: "신규 매장 리스트 메일",
  daily_digest: "매일 푸시",
  saved_alerts: "보관함 가게 소식",
  expire_subscriptions: "구독 만료 정리",
  admin_daily_report: "일간 보고서",
  admin_weekly_report: "주간 보고서",
  admin_monthly_report: "월간 보고서",
  tier_stats: "등급 통계 계산",
  activity_stats: "이용자 통계 계산",
  api_status: "수집 API 상태 모음",
  purge_refresh_tokens: "만료 로그인 토큰 정리",
  stats_flush: "통계 기록 적재",
};

const STATUS: Record<JobStatus, { icon: string; label: string; cls: string }> = {
  failed: { icon: "✕", label: "실패", cls: "badge bad" },
  skipped: { icon: "–", label: "건너뜀", cls: "badge" },
  ok: { icon: "✓", label: "성공", cls: "badge good" },
};

const ORDER: Record<JobStatus, number> = { failed: 0, skipped: 1, ok: 2 };

/** 오픈콜 배치 작업의 마지막 실행 결과. 문제가 있었던 작업을 맨 위에 둔다. */
export default function JobsCard() {
  const jobs = useApi<JobsStatus>("/api/opencall/jobs");
  const notConfigured = jobs.error?.code === "not_configured";

  // 서버도 같은 순서로 주지만, 화면에서도 한 번 더 맞춘다: 실패 → 24시간 안에 실패가 있었던 것 → 나머지(최근 순).
  const rows = [...(jobs.data?.jobs ?? [])].sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      Number(b.fails_24h > 0) - Number(a.fails_24h > 0) ||
      b.finished_at.localeCompare(a.finished_at),
  );

  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2>배치 상태</h2>
          {jobs.data && (
            <p className="sub muted">기록 반영 {dateTime(jobs.data.flushed_at)} · 5분마다 모아서 반영</p>
          )}
        </div>
        <button type="button" onClick={jobs.reload} disabled={jobs.loading}>
          {jobs.loading ? "불러오는 중…" : "새로고침"}
        </button>
      </header>

      {!jobs.loading && notConfigured && <p className="notice">오픈콜 관리자 API 가 아직 연결되지 않았습니다.</p>}
      {!jobs.loading && jobs.error && !notConfigured && <p className="notice error">{jobs.error.message}</p>}
      {jobs.data && rows.length === 0 && <p className="muted">아직 실행 기록이 없습니다.</p>}

      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="jobs">
            <thead>
              <tr>
                <th>상태</th>
                <th>작업</th>
                <th>마지막 실행</th>
                <th className="num">걸린 시간</th>
                <th className="num">처리 건수</th>
                <th className="num">24시간 실패</th>
                <th>마지막 성공</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const s = STATUS[j.status];
                return (
                  <tr key={j.job} className={j.status === "failed" ? "row-bad" : undefined}>
                    <td>
                      <span className={s.cls}>
                        <span aria-hidden="true">{s.icon}</span> {s.label}
                      </span>
                    </td>
                    <td>
                      {JOB_NAMES[j.job] ?? j.job}
                      {j.error && <div className="job-error">{j.error}</div>}
                    </td>
                    <td>{dateTime(j.finished_at)}</td>
                    <td className="num">{duration(j.duration_ms)}</td>
                    <td className="num">{j.items.toLocaleString("ko-KR")}</td>
                    <td className={j.fails_24h > 0 ? "num bad" : "num"}>
                      {j.fails_24h} / {j.runs_24h}
                    </td>
                    <td>{dateTime(j.last_ok_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
