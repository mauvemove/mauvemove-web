import { type FormEvent, useState } from "react";
import { recentRange } from "../format";

export const UNITS = [
  { id: "day", name: "일별", days: 30 },
  { id: "week", name: "주별", days: 7 * 12 },
  { id: "month", name: "월별", days: 365 },
] as const;
export type Unit = (typeof UNITS)[number]["id"];

/** 등급별 현황·이용자 카드가 함께 쓰는 조회 기간. */
export interface Period {
  unit: Unit;
  from: string;
  to: string;
}

export function defaultPeriod(unit: Unit = "day"): Period {
  return { unit, ...recentRange(UNITS.find((u) => u.id === unit)!.days) };
}

export function periodQuery(p: Period): string {
  return `from=${p.from}&to=${p.to}&unit=${p.unit}`;
}

export function periodLabel(period: string, unit: Unit): string {
  const [, m, d] = period.split("-");
  if (unit === "month") return `${Number(m)}월`;
  return `${Number(m)}/${Number(d)}`;
}

/** 묶음 단위(일·주·월)와 시작·종료일. 조회를 누르면 onChange 로 알린다 (같은 값이면 다시 불러오기). */
export default function PeriodBar({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const [draft, setDraft] = useState(value);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onChange(draft);
  };

  const changeUnit = (u: Unit) => {
    const next = defaultPeriod(u);
    setDraft(next);
    onChange(next);
  };

  return (
    <form className="range" onSubmit={submit}>
      <div className="segmented" role="group" aria-label="묶음 단위">
        {UNITS.map((u) => (
          <button
            key={u.id}
            type="button"
            className={draft.unit === u.id ? "on" : ""}
            aria-pressed={draft.unit === u.id}
            onClick={() => changeUnit(u.id)}
          >
            {u.name}
          </button>
        ))}
      </div>
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
      <button type="submit">조회</button>
    </form>
  );
}
