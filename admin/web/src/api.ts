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
