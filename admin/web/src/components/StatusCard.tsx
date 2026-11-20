import type { ServicesState } from "../App";
import type { ServiceId } from "../api";

/** 서비스 백엔드가 살아 있는지와 버전을 보여 준다. */
export default function StatusCard({ id, services }: { id: ServiceId; services: ServicesState }) {
  const status = services.find(id);

  return (
    <section className="card">
      <header className="card-head">
        <h2>서버 상태</h2>
        <button type="button" onClick={services.reload} disabled={services.loading}>
          {services.loading ? "확인 중…" : "다시 확인"}
        </button>
      </header>

      {services.error && <p className="notice error">{services.error.message}</p>}

      {status && (
        <dl className="facts">
          <div>
            <dt>상태</dt>
            <dd className={status.ok ? "good" : "bad"}>{status.ok ? "정상" : "응답 없음"}</dd>
          </div>
          <div>
            <dt>버전</dt>
            <dd>{status.version ?? "-"}</dd>
          </div>
          <div>
            <dt>응답 시간</dt>
            <dd>{status.latencyMs.toLocaleString()} ms</dd>
          </div>
          <div>
            <dt>API 주소</dt>
            <dd className="mono">{status.apiUrl}</dd>
          </div>
        </dl>
      )}

      {status && !status.ok && status.error && <p className="notice error">{status.error}</p>}
    </section>
  );
}
