import { useState } from "react";
import { TIER_NAMES, TIERS, type Tier, type TierStats, useApi } from "../api";
import { count, dateTime, micros, percent, won } from "../format";
import { type Period, periodLabel, periodQuery } from "./PeriodBar";
import { MiniLine, StackedBars } from "./charts";

// 등급마다 고정된 색. 순서가 바뀌거나 계열이 빠져도 같은 등급은 같은 색이다.
const TIER_COLOR: Record<Tier, string> = {
  guest: "var(--series-1)",
  regular: "var(--series-2)",
  premium: "var(--series-3)",
  free: "var(--series-4)",
};

function runningSum(values: number[]): number[] {
  let acc = 0;
  return values.map((v) => (acc += v));
}

/** 오픈콜 등급별(게스트·정기·프리미엄·무료 명단) 사람 수·매출·비율과 기간별 추이. */
export default function TierStatsCard({ period }: { period: Period }) {
  const [showTable, setShowTable] = useState(false);
  const [cumulative, setCumulative] = useState(false);
  const stats = useApi<TierStats>(`/api/opencall/tiers?${periodQuery(period)}`);

  const data = stats.data;
  const notConfigured = stats.error?.code === "not_configured";
  const totalUsers = data ? TIERS.reduce((s, t) => s + data.summary[t].users, 0) : 0;
  const totalRevenue = data ? TIERS.reduce((s, t) => s + data.summary[t].revenue_krw, 0) : 0;
  const labels = data ? data.series.map((p) => periodLabel(p.period, data.unit)) : [];

  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2>등급별 현황</h2>
          {data && (
            <p className="sub muted">
              {dateTime(data.updated_at)} 기준 · 5분마다 다시 계산
            </p>
          )}
        </div>
      </header>

      {stats.loading && <p className="muted">불러오는 중…</p>}
      {!stats.loading && notConfigured && (
        <p className="notice">오픈콜 관리자 API 가 아직 연결되지 않았습니다.</p>
      )}
      {!stats.loading && stats.error && !notConfigured && <p className="notice error">{stats.error.message}</p>}

      {!stats.loading && data && (
        <>
          <div className="tiers">
            {TIERS.map((t) => {
              const v = data.summary[t];
              return (
                <div key={t} className={t === "free" ? "tier tier-free" : "tier"}>
                  <div className="tier-name">
                    <span className="swatch" style={{ background: TIER_COLOR[t] }} aria-hidden="true" />
                    {TIER_NAMES[t]}
                  </div>
                  <div className="tier-big">
                    {count(v.users)}
                    <small>명</small>
                  </div>
                  <dl>
                    <dt>인원 비율</dt>
                    <dd>{percent(v.users, totalUsers)}</dd>
                    <dt>구독 매출</dt>
                    <dd>{won(v.revenue_krw)}</dd>
                    <dt>매출 비율</dt>
                    <dd>{percent(v.revenue_krw, totalRevenue)}</dd>
                    <dt>광고 수익</dt>
                    <dd>{micros(v.ad_revenue_micros)}</dd>
                    <dt className="sep">누적 매출</dt>
                    <dd className="sep">{won(data.all_time[t].revenue_krw)}</dd>
                  </dl>
                </div>
              );
            })}
          </div>
          <p className="muted small">
            인원은 기간 마지막 날 기준, 매출은 조회 기간 합계(환불 뺀 값), 누적 매출은 기록을 시작한 날부터 지금까지입니다. 무료 명단은 결제 없이 정기 기능을 쓰는
            사람이라 정기에 넣지 않고 따로 셉니다. 전체 {count(totalUsers)}명 · 구독 매출 {won(totalRevenue)}
          </p>

          <div className="card-subhead">
            <h3>인원 추이</h3>
            <button type="button" onClick={() => setShowTable(!showTable)}>
              {showTable ? "그래프로 보기" : "표로 보기"}
            </button>
          </div>

          {showTable ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>기간</th>
                    {TIERS.map((t) => (
                      <th key={t} className="num">
                        {TIER_NAMES[t]}
                      </th>
                    ))}
                    <th className="num">정기 매출</th>
                    <th className="num">프리미엄 매출</th>
                  </tr>
                </thead>
                <tbody>
                  {data.series.map((p, i) => (
                    <tr key={p.period}>
                      <td>{labels[i]}</td>
                      {TIERS.map((t) => (
                        <td key={t} className="num">
                          {count(p.tiers[t].users)}
                        </td>
                      ))}
                      <td className="num">{won(p.tiers.regular.revenue_krw)}</td>
                      <td className="num">{won(p.tiers.premium.revenue_krw)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="multiples">
                {TIERS.map((t) => (
                  <MiniLine
                    key={t}
                    title={TIER_NAMES[t]}
                    color={TIER_COLOR[t]}
                    format={count}
                    points={data.series.map((p, i) => ({ label: labels[i], value: p.tiers[t].users }))}
                  />
                ))}
              </div>
              <div className="card-subhead">
                <h3>구독 매출 추이</h3>
                <div className="segmented" role="group" aria-label="매출 보기">
                  {[
                    { on: false, name: "기간별" },
                    { on: true, name: "누적" },
                  ].map((o) => (
                    <button
                      key={o.name}
                      type="button"
                      className={cumulative === o.on ? "on" : ""}
                      aria-pressed={cumulative === o.on}
                      onClick={() => setCumulative(o.on)}
                    >
                      {o.name}
                    </button>
                  ))}
                </div>
              </div>
              <StackedBars
                labels={labels}
                format={won}
                series={(["regular", "premium"] as const).map((t) => {
                  const values = data.series.map((p) => p.tiers[t].revenue_krw);
                  return { name: TIER_NAMES[t], color: TIER_COLOR[t], values: cumulative ? runningSum(values) : values };
                })}
              />
              {cumulative && <p className="muted small">조회 시작일부터 쌓은 금액입니다.</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
