import type { ServicesState } from "../App";
import StatusCard from "../components/StatusCard";

export default function LottosmashPage({ services }: { services: ServicesState }) {
  return (
    <>
      <h1>로또스매시</h1>
      <StatusCard id="lottosmash" services={services} />
      <section className="card">
        <h2>관리 화면</h2>
        <p className="muted">아직 연결된 관리 기능이 없습니다. 지금은 서버 상태만 확인할 수 있습니다.</p>
      </section>
    </>
  );
}
