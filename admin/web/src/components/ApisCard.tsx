import { useState } from "react";
import { type ApiStatus, type ApisStatus, useApi } from "../api";
import { count, dateTime } from "../format";

const STATUS: Record<ApiStatus["status"], { icon: string; label: string; cls: string }> = {
  failed: { icon: "✕", label: "실패", cls: "badge bad" },
  never: { icon: "–", label: "기록 없음", cls: "badge" },
  ok: { icon: "✓", label: "성공", cls: "badge good" },
};

/** 처음에는 문제 있는 API 와 성공 몇 개만 보여 주고, 나머지는 "모두 보기"로 편다. */
const COLLAPSED_OK = 8;

/** 인허가 업종 API(data.go.kr) 별 마지막 수집 결과, 가져온 건수, 누적 건수. */
export default function ApisCard() {
  const apis = useApi<ApisStatus>("/api/opencall/apis");
  const [all, setAll] = useState(false);
  const notConfigured = apis.error?.code === "not_configured";
  const data = apis.data;
  const rows = data?.apis ?? [];
  const problems = rows.filter((a) => a.status !== "ok");
  const oks = rows.filter((a) => a.status === "ok");
  const shown = all ? rows : [...problems, ...oks.slice(0, COLLAPSED_OK)];

  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2>수집 API 상태</h2>
          {data && (
            <p className="sub muted">
              {dateTime(data.computed_at)} 기준 · 5분마다 다시 모음 · 누적 건수는 {dateTime(data.total_counted_at)}에 셈
              (한 시간마다)
            </p>
          )}
        </div>
        <button type="button" onClick={apis.reload} disabled={apis.loading}>
          {apis.loading ? "불러오는 중…" : "새로고침"}
        </button>
      </header>

      {!apis.loading && notConfigured && <p className="notice">오픈콜 관리자 API 가 아직 연결되지 않았습니다.</p>}
      {!apis.loading && apis.error && !notConfigured && <p className="notice error">{apis.error.message}</p>}

      {data && (
        <dl className="facts">
          <div>
            <dt>API</dt>
            <dd>{count(rows.length)}개</dd>
          </div>
          <div>
            <dt>실패</dt>
            <dd className={data.failed > 0 ? "bad" : undefined}>{count(data.failed)}개</dd>
          </div>
          <div>
            <dt>기록 없음</dt>
            <dd>{count(data.never)}개</dd>
          </div>
          <div>
            <dt>누적 건수</dt>
            <dd>{count(data.total_rows)}건</dd>
          </div>
        </dl>
      )}

      {shown.length > 0 && (
        <div className="table-scroll">
          <table className="jobs">
            <thead>
              <tr>
                <th>상태</th>
                <th>업종 API</th>
                <th>마지막 수집</th>
                <th className="num">가져온 건수</th>
                <th className="num">새 매장</th>
                <th className="num">누적 건수</th>
                <th className="num">조각 실패</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => {
                const s = STATUS[a.status];
                return (
                  <tr key={a.code} className={a.status === "failed" ? "row-bad" : undefined}>
                    <td>
                      <span className={s.cls}>
                        <span aria-hidden="true">{s.icon}</span> {s.label}
                      </span>
                    </td>
                    <td>
                      {a.name}
                      <div className="muted small mono">{a.code}</div>
                      {a.error && <div className="job-error">{a.error}</div>}
                    </td>
                    <td>{dateTime(a.last_run_at)}</td>
                    <td className="num">{count(a.fetched)}</td>
                    <td className="num">{count(a.inserted)}</td>
                    <td className="num">{count(a.total_rows)}</td>
                    <td className={a.failed_chunks > 0 ? "num bad" : "num"}>
                      {count(a.failed_chunks)} / {count(a.chunks)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown.length && (
        <button type="button" className="more" onClick={() => setAll(true)}>
          성공한 API {count(rows.length - shown.length)}개 더 보기
        </button>
      )}
      {all && oks.length > COLLAPSED_OK && (
        <button type="button" className="more" onClick={() => setAll(false)}>
          접기
        </button>
      )}
    </section>
  );
}
