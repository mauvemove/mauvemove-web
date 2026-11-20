import { useCallback, useEffect, useState } from "react";

export type ServiceId = "opencall" | "nongolbus" | "lottosmash";

export interface ServiceStatus {
  id: ServiceId;
  name: string;
  apiUrl: string;
  ok: boolean;
  version?: string;
  error?: string;
  latencyMs: number;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  postedDate?: string;
}

export interface NoticesByPlatform {
  android: Notice[];
  ios: Notice[];
}

export interface AdStats {
  total_revenue_micros: number;
  by_feature: { feature: string; count: number; revenue_micros: number }[] | null;
  by_user: { user_id: number | null; count: number; revenue_micros: number }[] | null;
}

/** BFF 가 돌려준 오류. code 로 화면에서 경우를 나눈다. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network", "백오피스 서버에 연결하지 못했습니다.");
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, e.error ?? "unknown", e.message ?? `요청이 실패했습니다 (HTTP ${res.status}).`);
  }
  return body as T;
}

export interface Loadable<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/** path 가 바뀌거나 reload 를 부르면 다시 가져온다. path 가 null 이면 가져오지 않는다. */
export function useApi<T>(path: string | null): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    apiGet<T>(path, controller.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(err instanceof ApiError ? err : new ApiError(0, "unknown", "알 수 없는 오류가 발생했습니다."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** 오픈콜 등급. free 는 무료 명단(결제 없이 정기 기능을 쓰는 사람)으로, 정기에 넣지 않고 따로 센다. */
export type Tier = "guest" | "regular" | "premium" | "free";

export const TIERS: Tier[] = ["guest", "regular", "premium", "free"];

export const TIER_NAMES: Record<Tier, string> = {
  guest: "게스트",
  regular: "정기",
  premium: "프리미엄",
  free: "무료 명단",
};

export interface TierValue {
  /** 사람 수. 기간 묶음(주·월)에서는 그 기간 마지막 날 값이다. */
  users: number;
  /** 구독 매출(원). 결제에서 환불을 뺀 값, 기간 합이다. */
  revenue_krw: number;
  /** 광고 수익(micros). 통화는 광고 SDK 가 준 그대로다. */
  ad_revenue_micros: number;
}

export interface TierStats {
  unit: "day" | "week" | "month";
  from: string;
  to: string;
  /** 오픈콜 서버가 등급 통계를 마지막으로 계산한 시각 (5분마다). 아직 없으면 null. */
  updated_at: string | null;
  /** 사람 수는 마지막 기간 값, 매출은 조회 기간 합이다. */
  summary: Record<Tier, TierValue>;
  /** 기록이 시작된 날부터 지금까지의 누적 매출 (조회 기간과 무관, users 는 0). */
  all_time: Record<Tier, TierValue>;
  series: { period: string; tiers: Record<Tier, TierValue> }[];
}

export type JobStatus = "ok" | "failed" | "skipped";

export interface JobSummary {
  job: string;
  status: JobStatus;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  items: number;
  error: string;
  /** 마지막으로 성공한 시각. 한 번도 성공하지 않았으면 null. */
  last_ok_at: string | null;
  runs_24h: number;
  fails_24h: number;
}

export interface JobsStatus {
  /** 실행 기록이 DB 에 마지막으로 반영된 시각 (5분마다 모아서 넣는다). */
  flushed_at: string | null;
  /** 실패한 작업이 먼저, 그다음 최근에 끝난 순서다. */
  jobs: JobSummary[];
}

export interface ActivityValue {
  /** 그날 앱을 쓴 사람. 주·월로 묶으면 하루 평균. */
  dau: number;
  /** 그 시점 기준 최근 30일 안에 앱을 쓴 사람. 묶으면 마지막 날 값. */
  mau: number;
  /** 그날 가입한 사람. 묶으면 합. */
  new_users: number;
  /** 가입자 누적 (테스트·탈퇴 계정 제외). 묶으면 마지막 날 값. */
  total_users: number;
}

export interface ActivityStats {
  unit: "day" | "week" | "month";
  from: string;
  to: string;
  updated_at: string | null;
  /** 조회 기간 마지막 날 값 (오늘이면 지금까지). */
  latest: ActivityValue;
  series: ({ period: string } & ActivityValue)[];
}

export interface ApiStatus {
  /** data.go.kr 업종 API 경로 (general_restaurants 등) */
  code: string;
  name: string;
  /** never = 아직 한 번도 수집하지 않음 */
  status: "ok" | "failed" | "never";
  last_run_at: string | null;
  /** 마지막 회차의 조각(업종 × 자치단체) 수와 그중 오류가 남은 조각 수 */
  chunks: number;
  failed_chunks: number;
  /** 마지막 회차에 받은 건수, 그중 새로 들어간 매장 */
  fetched: number;
  inserted: number;
  /** DB 에 쌓인 그 업종 매장 수 */
  total_rows: number;
  error: string;
}

export interface ApisStatus {
  computed_at: string | null;
  total_counted_at: string | null;
  ok: number;
  failed: number;
  never: number;
  total_rows: number;
  /** 실패 → 기록 없음 → 성공 순 */
  apis: ApiStatus[];
}
