import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { type Loadable, type ServiceId, type ServiceStatus, useApi } from "./api";
import LottosmashPage from "./pages/LottosmashPage";
import NongolbusPage from "./pages/NongolbusPage";
import OpencallPage from "./pages/OpencallPage";

// 사이드바 순서. 첫 번째가 첫 화면이다. (서버의 config.go 와 같은 순서)
const SERVICES: { id: ServiceId; name: string }[] = [
  { id: "opencall", name: "오픈콜" },
  { id: "nongolbus", name: "논골버스" },
  { id: "lottosmash", name: "로또스매시" },
];

export interface ServicesState extends Loadable<{ services: ServiceStatus[] }> {
  find: (id: ServiceId) => ServiceStatus | null;
}

export default function App() {
  const me = useApi<{ email: string }>("/api/me");
  const loaded = useApi<{ services: ServiceStatus[] }>("/api/services");
  const services: ServicesState = {
    ...loaded,
    find: (id) => loaded.data?.services.find((s) => s.id === id) ?? null,
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          MauveMove <span>백오피스</span>
        </div>
        <nav aria-label="서비스">
          {SERVICES.map((s) => {
            const status = services.find(s.id);
            const dot = status === null ? "unknown" : status.ok ? "ok" : "down";
            const label = status === null ? "확인 중" : status.ok ? "정상" : "응답 없음";
            return (
              <NavLink key={s.id} to={`/${s.id}`} className={({ isActive }) => (isActive ? "nav active" : "nav")}>
                <span className={`dot ${dot}`} role="img" aria-label={label} />
                {s.name}
              </NavLink>
            );
          })}
        </nav>
        <div className="me">{me.data?.email ?? (me.error ? "로그인 정보 없음" : "")}</div>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to={`/${SERVICES[0].id}`} replace />} />
          <Route path="/opencall" element={<OpencallPage services={services} />} />
          <Route path="/nongolbus" element={<NongolbusPage services={services} />} />
          <Route path="/lottosmash" element={<LottosmashPage services={services} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
