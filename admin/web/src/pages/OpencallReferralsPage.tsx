import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { type ReferralReport, useApi } from "../api";
import { count, dateTime, percent } from "../format";

const LIMIT = 200;

/** 오픈콜 추천인 코드: 코드별 가입 수·그중 지금 결제 중인 사람, 누가 어떤 코드로 가입했는지. */
export default function OpencallReferralsPage() {
  const [params, setParams] = useSearchParams();
  const code = /^[a-z0-9]{1,10}$/.test(params.get("code") ?? "") ? (params.get("code") as string) : "";
  const [draft, setDraft] = useState(code);

  const report = useApi<ReferralReport>(`/api/opencall/referrals?limit=${LIMIT}${code ? `&code=${code}` : ""}`);
  const codes = report.data?.codes ?? [];
  const recent = report.data?.recent ?? [];
  const paying = codes.reduce((sum, c) => sum + c.paying, 0);
  const notConfigured = report.error?.code === "not_configured";

  const pick = (next: string) => {
    setDraft(next);
    setParams(next ? { code: next } : {});
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = draft.trim().toLowerCase();
    if (next === code) report.reload();
    else pick(next);
  };

  return (
    <>
      <h1>오픈콜 추천 코드</h1>
      <section className="card">
        <header className="card-head">
          <h2>코드별 가입</h2>
          <button type="button" onClick={report.reload} disabled={report.loading}>
            {report.loading ? "불러오는 중…" : "새로고침"}
          </button>
        </header>

        {!report.loading && notConfigured && <p className="notice">오픈콜 관리자 API 가 아직 연결되지 않았습니다.</p>}
        {!report.loading && report.error && !notConfigured && <p className="notice error">{report.error.message}</p>}

        {report.data && (
          <>
            <dl className="facts">
              <div>
                <dt>코드를 넣고 가입한 사람</dt>
                <dd className="big">{count(report.data.total)}</dd>
              </div>
              <div>
                <dt>그중 지금 결제 중</dt>
                <dd className="big">
                  {count(paying)} <span className="muted small">{percent(paying, report.data.total)}</span>
                </dd>
              </div>
              <div>
                <dt>코드 수</dt>
                <dd className="big">{count(codes.length)}</dd>
              </div>
            </dl>

            {codes.length === 0 ? (
              <p className="muted">아직 추천 코드를 넣은 사람이 없습니다.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>코드</th>
                      <th className="num">가입</th>
                      <th className="num">지금 결제 중</th>
                      <th className="num">결제 비율</th>
                      <th>마지막 입력</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map((c) => (
                      <tr key={c.code} className={c.code === code ? "row-on" : undefined}>
                        <td>
                          <button type="button" className="link mono" onClick={() => pick(c.code === code ? "" : c.code)}>
                            {c.code}
                          </button>
                        </td>
                        <td className="num">{count(c.count)}</td>
                        <td className="num">{count(c.paying)}</td>
                        <td className="num">{percent(c.paying, c.count)}</td>
                        <td>{dateTime(c.last_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">
              가입 수에는 탈퇴한 사람도 들어갑니다. 결제 중은 스토어 정기 결제가 살아 있는 사람입니다 (무료 명단·테스트 결제 제외).
            </p>
          </>
        )}
      </section>

      <section className="card">
        <header className="card-head">
          <h2>{code ? `"${code}" 로 가입한 사람` : "최근 코드를 넣은 사람"}</h2>
          <form className="range" onSubmit={submit}>
            <label>
              코드로 찾기
              <input
                type="text"
                value={draft}
                maxLength={10}
                pattern="[a-zA-Z0-9]{0,10}"
                placeholder="전체"
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
            <button type="submit" disabled={report.loading}>
              조회
            </button>
            {code && (
              <button type="button" onClick={() => pick("")}>
                전체 보기
              </button>
            )}
          </form>
        </header>

        {report.data && recent.length === 0 && <p className="muted">해당하는 사람이 없습니다.</p>}

        {recent.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>닉네임</th>
                  <th className="num">유저 ID</th>
                  <th>코드</th>
                  <th>코드 넣은 때</th>
                  <th>가입일</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={`${r.user_id ?? "x"}-${r.entered_at}-${i}`}>
                    <td>{r.user_id === null ? <span className="muted">탈퇴한 사용자</span> : r.nickname || "-"}</td>
                    <td className="num">{r.user_id ?? "-"}</td>
                    <td className="mono">{r.code}</td>
                    <td>{dateTime(r.entered_at)}</td>
                    <td>{dateTime(r.signup_at ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {recent.length >= LIMIT && <p className="muted small">최근 {LIMIT}명까지만 보여 줍니다. 코드로 찾으면 그 코드만 봅니다.</p>}
      </section>
    </>
  );
}
