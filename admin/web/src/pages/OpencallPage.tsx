import { type FormEvent, useState } from "react";
import type { ServicesState } from "../App";
import { type AdStats, useApi } from "../api";
import StatusCard from "../components/StatusCard";

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - 6);
  return { from: isoDate(from), to: isoDate(to) };
}

// 서버는 수익을 micros(1/1,000,000) 단위로 준다. 통화는 광고 SDK 가 준 값 그대로다.
function revenue(micros: number): string {
  return (micros / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function OpencallPage({ services }: { services: ServicesState }) {
  const [draft, setDraft] = useState(defaultRange);
  const [range, setRange] = useState(draft);
  const stats = useApi<AdStats>(`/api/opencall/ads/stats?from=${range.from}&to=${range.to}`);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.from === range.from && draft.to === range.to) stats.reload();
    else setRange(draft);
  };

  const byFeature = stats.data?.by_feature ?? [];
  const notConfigured = stats.error?.code === "not_configured";

  return (
    <>
      <h1>오픈콜</h1>
      <StatusCard id="opencall" services={services} />

      <section className="card">
        <header className="card-head">
          <h2>광고 통계</h2>
          <form className="range" onSubmit={submit}>
            <label>
              시작일
              <input
                type="date"
                value={draft.from}
                max={draft.to}
                required
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </label>
            <label>
              종료일
              <input
                type="date"
                value={draft.to}
                min={draft.from}
                required
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </label>
            <button type="submit" disabled={stats.loading}>
              조회
            </button>
          </form>
        </header>

        {stats.loading && <p className="muted">불러오는 중…</p>}

        {!stats.loading && notConfigured && (
          <p className="notice">
            오픈콜 관리자 API 가 아직 연결되지 않았습니다. 백오피스 서버에 <code>OPENCALL_ID_TOKEN_AUDIENCE</code>
            (운영) 또는 <code>OPENCALL_ADMIN_TOKEN</code>(로컬)을 설정하면 이 자리에 통계가 나옵니다.
          </p>
        )}

        {!stats.loading && stats.error && !notConfigured && <p className="notice error">{stats.error.message}</p>}

        {!stats.loading && stats.data && (
          <>
            <dl className="facts">
              <div>
                <dt>총 수익</dt>
                <dd>{revenue(stats.data.total_revenue_micros)}</dd>
              </div>
              <div>
                <dt>광고를 본 사용자</dt>
                <dd>{(stats.data.by_user ?? []).length.toLocaleString()}</dd>
              </div>
            </dl>

            {byFeature.length === 0 ? (
              <p className="muted">이 기간에는 광고 노출 기록이 없습니다.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>기능</th>
                    <th className="num">노출 수</th>
                    <th className="num">수익</th>
                  </tr>
                </thead>
                <tbody>
                  {byFeature.map((f) => (
                    <tr key={f.feature}>
                      <td>{f.feature}</td>
                      <td className="num">{f.count.toLocaleString()}</td>
                      <td className="num">{revenue(f.revenue_micros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </>
  );
}
