import { Fragment } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { type Loadable, type ServiceId, type ServiceStatus, useApi } from "./api";
import LottosmashPage from "./pages/LottosmashPage";
import NongolbusPage from "./pages/NongolbusPage";
import OpencallContactsPage from "./pages/OpencallContactsPage";
import OpencallPage from "./pages/OpencallPage";
import OpencallReferralsPage from "./pages/OpencallReferralsPage";

// 사이드바 순서. 첫 번째가 첫 화면이다. (서버의 config.go 와 같은 순서)
const SERVICES: { id: ServiceId; name: string; sub?: { path: string; name: string }[] }[] = [
  {
    id: "opencall",
    name: "오픈콜",
    sub: [
      { path: "contacts", name: "문의" },
      { path: "referrals", name: "추천 코드" },
    ],
  },
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
              <Fragment key={s.id}>
                <NavLink to={`/${s.id}`} end className={({ isActive }) => (isActive ? "nav active" : "nav")}>
                  <span className={`dot ${dot}`} role="img" aria-label={label} />
                  {s.name}
                </NavLink>
                {s.sub?.map((sub) => (
                  <NavLink
                    key={sub.path}
                    to={`/${s.id}/${sub.path}`}
                    className={({ isActive }) => (isActive ? "nav sub-nav active" : "nav sub-nav")}
                  >
                    {sub.name}
                  </NavLink>
                ))}
              </Fragment>
            );
          })}
        </nav>
        <div className="me">{me.data?.email ?? (me.error ? "로그인 정보 없음" : "")}</div>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to={`/${SERVICES[0].id}`} replace />} />
          <Route path="/opencall" element={<OpencallPage services={services} />} />
          <Route path="/opencall/contacts" element={<OpencallContactsPage />} />
          <Route path="/opencall/referrals" element={<OpencallReferralsPage />} />
          <Route path="/nongolbus" element={<NongolbusPage services={services} />} />
          <Route path="/lottosmash" element={<LottosmashPage services={services} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
