import { type MouseEvent, type RefObject, useEffect, useRef, useState } from "react";

// 손으로 그린 작은 SVG 차트. 차트 라이브러리를 들이지 않는다.
// 색은 styles.css 의 --series-* 토큰만 쓰고, 글자는 글자 색 토큰을 쓴다.

const PAD = { top: 12, right: 8, bottom: 22, left: 8 };

/** 요소의 실제 너비(px). 차트를 화면 크기에 맞춰 그리되 글자·선 굵기는 늘이지 않으려고 쓴다. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** 마우스 x 를 가장 가까운 점 번호로 바꾼다. */
function nearest(e: MouseEvent<SVGSVGElement>, n: number, x: (i: number) => number): number {
  const vx = e.clientX - e.currentTarget.getBoundingClientRect().left;
  let best = 0;
  for (let i = 1; i < n; i++) if (Math.abs(x(i) - vx) < Math.abs(x(best) - vx)) best = i;
  return best;
}

export interface LinePoint {
  label: string;
  value: number;
}

/** 한 계열 선 그래프. 작은 여러 장(small multiples)으로 나란히 쓴다. 범례 대신 제목이 계열 이름이다. */
export function MiniLine({
  title,
  color,
  points,
  format,
  height = 120,
}: {
  title: string;
  color: string;
  points: LinePoint[];
  format: (v: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth<HTMLDivElement>();
  const n = points.length;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v: number) => PAD.top + innerH - (innerH * v) / max;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const last = points[n - 1];
  const shown = hover ?? n - 1;

  return (
    <figure className="chart">
      <figcaption>
        <span className="swatch" style={{ background: color }} aria-hidden="true" />
        {title}
        {last && <strong>{format(points[shown].value)}</strong>}
        {last && <span className="muted">{points[shown].label}</span>}
      </figcaption>
      <div ref={ref}>
      <svg
        width={W}
        height={height}
        role="img"
        aria-label={`${title} 추이`}
        onMouseMove={(e) => n > 0 && setHover(nearest(e, n, x))}
        onMouseLeave={() => setHover(null)}
      >
        <line className="axis" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
        <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(max)} y2={y(max)} />
        <text className="tick" x={W - PAD.right} y={y(max) - 3} textAnchor="end">
          {format(max)}
        </text>
        {n > 0 && (
          <>
            <text className="tick" x={PAD.left} y={height - 6}>
              {points[0].label}
            </text>
            <text className="tick" x={W - PAD.right} y={height - 6} textAnchor="end">
              {last.label}
            </text>
          </>
        )}
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} />}
        {n > 0 && (
          <circle className="marker" cx={x(shown)} cy={y(points[shown].value)} r={4} fill={color} />
        )}
      </svg>
      </div>
    </figure>
  );
}

export interface StackSeries {
  name: string;
  color: string;
  values: number[];
}

/** 쌓은 막대 그래프. 막대에 마우스를 올리면 그 기간의 계열별 값을 보여 준다. */
export function StackedBars({
  labels,
  series,
  format,
  height = 180,
}: {
  labels: string[];
  series: StackSeries[];
  format: (v: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth<HTMLDivElement>();
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((s, ser) => s + ser.values[i], 0));
  const max = niceMax(Math.max(0, ...totals));
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const slot = n > 0 ? innerW / n : innerW;
  const barW = Math.max(2, Math.min(28, slot * 0.6));
  const cx = (i: number) => PAD.left + slot * (i + 0.5);
  const h = (v: number) => (innerH * v) / max;
  const base = PAD.top + innerH;

  return (
    <figure className="chart">
      <figcaption>
        <ul className="legend">
          {series.map((s) => (
            <li key={s.name}>
              <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
              {s.name}
            </li>
          ))}
        </ul>
      </figcaption>
      <div className="chart-plot" ref={ref}>
        <svg
          width={W}
          height={height}
          role="img"
          aria-label="기간별 구독 매출"
          onMouseMove={(e) => n > 0 && setHover(nearest(e, n, cx))}
          onMouseLeave={() => setHover(null)}
        >
          <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={PAD.top} y2={PAD.top} />
          <text className="tick" x={W - PAD.right} y={PAD.top - 3} textAnchor="end">
            {format(max)}
          </text>
          {labels.map((label, i) => {
            let top = base;
            return (
              <g key={label} opacity={hover === null || hover === i ? 1 : 0.45}>
                {series.map((s, k) => {
                  const segH = h(s.values[i]);
                  if (segH <= 0) return null;
                  // 맨 위 조각만 위쪽 모서리를 둥글게. 조각 사이는 2px 띄운다.
                  const isTop = series.slice(k + 1).every((t) => t.values[i] <= 0);
                  const gap = isTop ? 0 : 2;
                  top -= segH;
                  const r = isTop ? Math.min(4, barW / 2, segH) : 0;
                  const y0 = top + gap;
                  const hh = Math.max(0, segH - gap);
                  const x0 = cx(i) - barW / 2;
                  const d = `M${x0},${y0 + hh}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + barW - r}Q${x0 + barW},${y0} ${x0 + barW},${y0 + r}V${y0 + hh}Z`;
                  return <path key={s.name} d={d} fill={s.color} />;
                })}
              </g>
            );
          })}
          <line className="axis" x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} />
          {n > 0 && (
            <>
              <text className="tick" x={PAD.left} y={height - 6}>
                {labels[0]}
              </text>
              <text className="tick" x={W - PAD.right} y={height - 6} textAnchor="end">
                {labels[n - 1]}
              </text>
            </>
          )}
        </svg>
        {hover !== null && (
          <div className="tooltip" style={{ left: Math.min(Math.max(cx(hover), 70), W - 70) }} role="status">
            <strong>{labels[hover]}</strong>
            {series.map((s) => (
              <div key={s.name}>
                <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
                {s.name} {format(s.values[hover])}
              </div>
            ))}
            <div className="muted">합계 {format(totals[hover])}</div>
          </div>
        )}
      </div>
    </figure>
  );
}
