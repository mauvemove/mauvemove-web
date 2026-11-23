import { useState } from "react";
import { type DensityRegion, type DensityStats, useApi } from "../api";
import { count, dateTime, percent } from "../format";

const DAYS = [30, 90, 180];

/** 처음에는 사람 많은 구 몇 개만 보여 주고, 나머지는 "더 보기"로 편다. */
const COLLAPSED = 15;

function churn(regular: number, churned: number): string {
  return percent(churned, regular + churned);
}

function people(r: { regular: number; free: number; premium: number }): number {
  return r.regular + r.free + r.premium;
}

function types(r: DensityRegion): string {
  return r.by_type
    .filter((t) => people(t) > 0)
    .map((t) => `${t.name} ${count(people(t))}`)
    .join(" · ");
}

/**
 * 지역 밀도: 같은 구에 같은 업종 사람이 몰리면(포화) 해지가 느는지 본다.
 * 계산 방식은 opencall-server docs/BACKOFFICE_STATS.md "지역 밀도".
 */
export default function DensityCard() {
  const [days, setDays] = useState(DAYS[0]);
  const [all, setAll] = useState(false);
  const density = useApi<DensityStats>(`/api/opencall/density?days=${days}`);
  const notConfigured = density.error?.code === "not_configured";
  const data = density.data;
  const rows = data?.regions ?? [];
  const shown = all ? rows : rows.slice(0, COLLAPSED);

  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2>지역 밀도</h2>
          <p className="sub muted">
            같은 구에 같은 업종이 몰리면 해지가 느는지 봅니다.
            {data?.as_of ? ` ${data.as_of} 기준 · ${dateTime(data.updated_at)}에 계산 (5분마다)` : ""}
          </p>
        </div>
        <div className="range">
          <label>
            해지를 세는 기간
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  최근 {d}일
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={density.reload} disabled={density.loading}>
            {density.loading ? "불러오는 중…" : "새로고침"}
          </button>
        </div>
      </header>

      {!density.loading && notConfigured && <p className="notice">오픈콜 관리자 API 가 아직 연결되지 않았습니다.</p>}
      {!density.loading && density.error && !notConfigured && <p className="notice error">{density.error.message}</p>}

      {data && (
        <>
          <dl className="facts">
            <div>
              <dt>정기 회원</dt>
              <dd>{count(data.summary.regular_users)}명</dd>
            </div>
            <div>
              <dt>최근 {data.churn_days}일 해지</dt>
              <dd>{count(data.summary.churned_users)}명</dd>
            </div>
            <div>
              <dt>회원이 있는 구</dt>
              <dd>{count(data.summary.regions)}곳</dd>
            </div>
            <div>
              <dt>몰린 구 (같은 업종 {data.crowded_min}명 이상)</dt>
              <dd className={data.summary.crowded_regions > 0 ? "bad" : undefined}>
                {count(data.summary.crowded_regions)}곳
              </dd>
            </div>
            <div>
              <dt>전국 프리미엄</dt>
              <dd>{count(data.summary.nationwide_premium)}명</dd>
            </div>
          </dl>

          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th className="num">구</th>
                <th className="num">정기</th>
                <th className="num">해지</th>
                <th className="num">해지율</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>몰린 구</td>
                <td className="num">{count(data.crowded.regions)}</td>
                <td className="num">{count(data.crowded.regular)}</td>
                <td className="num">{count(data.crowded.churned)}</td>
                <td className="num">{churn(data.crowded.regular, data.crowded.churned)}</td>
              </tr>
              <tr>
                <td>그 밖의 구</td>
                <td className="num">{count(data.not_crowded.regions)}</td>
                <td className="num">{count(data.not_crowded.regular)}</td>
                <td className="num">{count(data.not_crowded.churned)}</td>
                <td className="num">{churn(data.not_crowded.regular, data.not_crowded.churned)}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">
            해지율 = 해지 ÷ (지금 정기 + 해지). 다른 구로 옮겨 계속 결제하는 사람은 해지로 세지 않습니다. 사업장 형태를 안
            적은 정기 회원 {count(data.summary.no_type_users)}명은 "같은 업종"에 넣지 않습니다.
          </p>

          {rows.length === 0 ? (
            <p className="muted">아직 지역을 고른 유료 회원이 없습니다.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>시군구</th>
                    <th className="num">정기</th>
                    <th className="num">무료 명단</th>
                    <th className="num">프리미엄</th>
                    <th className="num">같은 업종 최대</th>
                    <th className="num">해지</th>
                    <th className="num">해지율</th>
                    <th>업종별</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.region} className={r.crowded ? "row-bad" : undefined}>
                      <td>
                        {r.region}
                        {r.crowded && (
                          <>
                            {" "}
                            <span className="badge bad">몰림</span>
                          </>
                        )}
                      </td>
                      <td className="num">{count(r.regular)}</td>
                      <td className="num">{count(r.free)}</td>
                      <td className="num">{count(r.premium)}</td>
                      <td className="num">{count(r.max_same_type)}</td>
                      <td className="num">{count(r.churned)}</td>
                      <td className="num">{churn(r.regular, r.churned)}</td>
                      <td className="muted small">{types(r) || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > shown.length && (
            <button type="button" className="more" onClick={() => setAll(true)}>
              {count(rows.length - shown.length)}곳 더 보기
            </button>
          )}
          {all && rows.length > COLLAPSED && (
            <button type="button" className="more" onClick={() => setAll(false)}>
              접기
            </button>
          )}
        </>
      )}
    </section>
  );
}
