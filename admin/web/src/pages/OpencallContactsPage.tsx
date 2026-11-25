import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ApiError,
  CONTACT_CATEGORIES,
  CONTACT_STATUSES,
  CONTACT_STATUS_NAMES,
  type Contact,
  type ContactList,
  type ContactReplyResult,
  type ContactStatus,
  apiSend,
  useApi,
} from "../api";
import { count, dateTime } from "../format";

const PAGE_SIZE = 50;
const MAX_ANSWER = 5000;

const STATUS_CLASS: Record<ContactStatus, string> = {
  open: "badge bad",
  answered: "badge good",
  closed: "badge",
};

function categoryName(c: Contact): string {
  return c.category_name || CONTACT_CATEGORIES.find((x) => x.id === c.category)?.name || c.category || "-";
}

function sender(c: Contact): string {
  return c.nickname || c.user_email || c.reply_email || (c.user_id ? `유저 ${c.user_id}` : "알 수 없음");
}

/** 오픈콜 사용자 문의: 목록(상태·분류로 거르기) → 한 건 보기 → 답변 보내기·닫기. */
export default function OpencallContactsPage() {
  const [params, setParams] = useSearchParams();
  const status = (CONTACT_STATUSES as string[]).includes(params.get("status") ?? "")
    ? (params.get("status") as ContactStatus)
    : "";
  const category = params.get("category") ?? "";
  const page = Math.max(0, Number(params.get("page")) || 0);
  const selected = /^[1-9]\d*$/.test(params.get("id") ?? "") ? Number(params.get("id")) : null;

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  };

  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
  if (status) query.set("status", status);
  if (category) query.set("category", category);
  const list = useApi<ContactList>(`/api/opencall/contacts?${query}`);

  const items = list.data?.items ?? [];
  const counts = list.data?.counts ?? {};
  const all = CONTACT_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  const total = list.data?.total ?? 0;
  const notConfigured = list.error?.code === "not_configured";

  return (
    <>
      <h1>오픈콜 문의</h1>
      <section className="card">
        <header className="card-head">
          <div className="filters">
            <div className="segmented" role="group" aria-label="상태">
              <button type="button" className={status === "" ? "on" : ""} onClick={() => set({ status: null, page: null })}>
                전체{list.data && ` ${count(all)}`}
              </button>
              {CONTACT_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={status === s ? "on" : ""}
                  onClick={() => set({ status: s, page: null })}
                >
                  {CONTACT_STATUS_NAMES[s]}
                  {list.data && ` ${count(counts[s] ?? 0)}`}
                </button>
              ))}
            </div>
            <label className="inline">
              분류
              <select value={category} onChange={(e) => set({ category: e.target.value, page: null })}>
                <option value="">전체</option>
                {CONTACT_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="button" onClick={list.reload} disabled={list.loading}>
            {list.loading ? "불러오는 중…" : "새로고침"}
          </button>
        </header>

        {!list.loading && notConfigured && <p className="notice">오픈콜 관리자 API 가 아직 연결되지 않았습니다.</p>}
        {!list.loading && list.error && !notConfigured && <p className="notice error">{list.error.message}</p>}
        {list.data && items.length === 0 && <p className="muted">조건에 맞는 문의가 없습니다.</p>}

        {items.length > 0 && (
          <div className="table-scroll">
            <table className="contacts">
              <thead>
                <tr>
                  <th className="num">번호</th>
                  <th>상태</th>
                  <th>분류</th>
                  <th>내용</th>
                  <th>보낸 사람</th>
                  <th>받은 때</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className={c.id === selected ? "row-on" : undefined}>
                    <td className="num">{c.id}</td>
                    <td>
                      <span className={STATUS_CLASS[c.status] ?? "badge"}>{CONTACT_STATUS_NAMES[c.status] ?? c.status}</span>
                    </td>
                    <td>{categoryName(c)}</td>
                    <td className="preview">
                      <button type="button" className="link" onClick={() => set({ id: String(c.id) })}>
                        {c.message}
                      </button>
                    </td>
                    <td>{sender(c)}</td>
                    <td>{dateTime(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {list.data && total > PAGE_SIZE && (
          <div className="pager">
            <button type="button" disabled={page === 0} onClick={() => set({ page: page > 1 ? String(page - 1) : null })}>
              이전
            </button>
            <span className="muted small">
              {count(page * PAGE_SIZE + 1)}–{count(Math.min(total, (page + 1) * PAGE_SIZE))} / {count(total)}
            </span>
            <button type="button" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => set({ page: String(page + 1) })}>
              다음
            </button>
          </div>
        )}
      </section>

      {selected !== null && (
        <ContactDetail key={selected} id={selected} onChanged={list.reload} onClose={() => set({ id: null })} />
      )}
    </>
  );
}

function ContactDetail({ id, onChanged, onClose }: { id: number; onChanged: () => void; onClose: () => void }) {
  const loaded = useApi<Contact>(`/api/opencall/contacts/${id}`);
  // 답변·상태 변경 응답으로 받은 최신 값. 있으면 이것을 보여 준다.
  const [updated, setUpdated] = useState<Contact | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ContactReplyResult | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const c = updated ?? loaded.data;
  const text = answer.trim();

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const reply = (e: FormEvent) => {
    e.preventDefault();
    if (!text || busy) return;
    void run(async () => {
      const res = await apiSend<ContactReplyResult>("POST", `/api/opencall/contacts/${id}/reply`, { answer: text });
      setUpdated(res.item);
      setSent(res);
      setAnswer("");
    });
  };

  const setStatus = (status: ContactStatus) =>
    void run(async () => {
      setSent(null);
      setUpdated(await apiSend<Contact>("PATCH", `/api/opencall/contacts/${id}`, { status }));
    });

  return (
    <section className="card" ref={ref} aria-live="polite">
      <header className="card-head">
        <h2>
          문의 {id}번{" "}
          {c && <span className={STATUS_CLASS[c.status] ?? "badge"}>{CONTACT_STATUS_NAMES[c.status] ?? c.status}</span>}
        </h2>
        <button type="button" onClick={onClose}>
          접기
        </button>
      </header>

      {loaded.loading && !c && <p className="muted">불러오는 중…</p>}
      {loaded.error && !c && <p className="notice error">{loaded.error.message}</p>}

      {c && (
        <>
          <dl className="facts">
            <div>
              <dt>분류</dt>
              <dd>{categoryName(c)}</dd>
            </div>
            <div>
              <dt>받은 때</dt>
              <dd>{dateTime(c.created_at)}</dd>
            </div>
            <div>
              <dt>보낸 사람</dt>
              <dd>
                {c.nickname || "-"}
                {c.user_id ? <span className="muted small"> 유저 {c.user_id}</span> : <span className="muted small"> 계정 없음</span>}
              </dd>
            </div>
            <div>
              <dt>계정 메일</dt>
              <dd>{c.user_email || "-"}</dd>
            </div>
            <div>
              <dt>답장 받을 메일</dt>
              <dd>{c.reply_email || "-"}</dd>
            </div>
            <div>
              <dt>앱·기기</dt>
              <dd>
                {[c.app_version && `v${c.app_version}`, c.platform, c.os_version, c.device_model].filter(Boolean).join(" · ") || "-"}
              </dd>
            </div>
          </dl>

          <h3>문의 내용</h3>
          <p className="bubble">{c.message}</p>
          {c.context && (
            <>
              <h3>보낼 때 화면 상황</h3>
              <p className="bubble mono">{c.context}</p>
            </>
          )}

          {c.answer && (
            <>
              <h3>
                보낸 답변 · {dateTime(c.answered_at ?? null)}
                {c.answered_by && ` · ${c.answered_by}`} ·{" "}
                {c.user_read_at ? `사용자가 봄 ${dateTime(c.user_read_at)}` : "사용자가 아직 안 봄"}
              </h3>
              <p className="bubble answer">{c.answer}</p>
            </>
          )}

          {sent && (
            <p className="notice">
              답변을 저장했습니다. 앱 푸시: {sent.push_sent ? "보냄" : "못 보냄 (기기 없음·알림 꺼짐·푸시 미설정)"} · 답장 메일:{" "}
              {sent.mail_sent ? "보냄" : c.reply_email ? "못 보냄" : "적은 주소 없음"}
            </p>
          )}
          {error && <p className="notice error">{error}</p>}

          <form className="reply" onSubmit={reply}>
            <label htmlFor="answer">
              {c.answer ? "답변 다시 쓰기 (앞 답변을 덮어쓰고 다시 알립니다)" : "답변"}
            </label>
            <textarea
              id="answer"
              rows={6}
              maxLength={MAX_ANSWER}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="사용자 앱 '내 문의'에 그대로 보입니다."
            />
            <div className="reply-actions">
              <span className="muted small">
                {count(answer.length)} / {count(MAX_ANSWER)} · 보내면 앱 푸시{c.reply_email ? "와 메일" : ""}로 알립니다
              </span>
              {c.status === "closed" ? (
                <button type="button" disabled={busy} onClick={() => setStatus(c.answer ? "answered" : "open")}>
                  다시 열기
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => setStatus("closed")}>
                  {c.answer ? "닫기" : "답변 없이 닫기"}
                </button>
              )}
              <button type="submit" className="primary" disabled={busy || !text}>
                {busy ? "처리 중…" : c.answer ? "답변 다시 보내기" : "답변 보내기"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
