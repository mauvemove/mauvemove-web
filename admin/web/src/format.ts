export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 오늘을 포함한 최근 days 일. */
export function recentRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(to) };
}

export function count(n: number): string {
  return n.toLocaleString("ko-KR");
}

export function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

/** 광고 수익은 micros(1/1,000,000) 단위다. 통화는 광고 SDK 가 준 값 그대로다. */
export function micros(m: number): string {
  return (m / 1_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

export function percent(part: number, total: number): string {
  if (total <= 0) return "-";
  return `${((part / total) * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
}

/** "11월 20일 22:45" 처럼 짧은 시각. */
export function dateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 ${s % 60}초`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
