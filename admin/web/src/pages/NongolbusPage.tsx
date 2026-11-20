import type { ServicesState } from "../App";
import { type Notice, type NoticesByPlatform, useApi } from "../api";
import StatusCard from "../components/StatusCard";

function NoticeList({ platform, notices }: { platform: string; notices: Notice[] }) {
  return (
    <div className="platform">
      <h3>{platform}</h3>
      {notices.length === 0 ? (
        <p className="muted">지금 나가는 공지가 없습니다.</p>
      ) : (
        <ul className="notices">
          {notices.map((n) => (
            <li key={n.id}>
              <strong>{n.title}</strong>
              <p>{n.body}</p>
              <span className="muted mono">
                {n.id}
                {n.postedDate ? ` · ${n.postedDate}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NongolbusPage({ services }: { services: ServicesState }) {
  const notices = useApi<NoticesByPlatform>("/api/nongolbus/notices");

  return (
    <>
      <h1>논골버스</h1>
      <StatusCard id="nongolbus" services={services} />

      <section className="card">
        <header className="card-head">
          <h2>지금 앱에 나가는 공지</h2>
          <button type="button" onClick={notices.reload} disabled={notices.loading}>
            {notices.loading ? "불러오는 중…" : "새로고침"}
          </button>
        </header>

        {notices.error && <p className="notice error">{notices.error.message}</p>}

        {notices.data && (
          <div className="platforms">
            <NoticeList platform="Android" notices={notices.data.android} />
            <NoticeList platform="iOS" notices={notices.data.ios} />
          </div>
        )}

        <p className="notice">
          논골버스는 DB 를 쓰지 않아 공지를 여기서 고칠 수 없습니다. 제목·내용·공지 기간은 서버 설정 파일의{" "}
          <code>notices</code> 에 적고 <code>scripts/push-config.sh</code> 로 올립니다. 꺼 둔 공지나 기간이 아닌
          공지는 이 화면에 나오지 않습니다.
        </p>
      </section>
    </>
  );
}
