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
  return request<T>(path, { signal, headers: { Accept: "application/json" } });
}

/** 바꾸는 요청 (POST·PATCH). 본문은 JSON 으로 보낸다. */
export async function apiSend<T>(method: "POST" | "PATCH", path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
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

/** 앱 사용 통계의 등급. 무료 명단은 토큰상 정기라 regular 에 들어간다. */
export type UsageTier = "guest" | "regular" | "premium";

export interface SavedTierUsage {
  /** 기간 안에 앱을 쓴 사람 */
  active_users: number;
  /** 보관함에 새로 담은 사람 */
  saver_users: number;
  /** 진행 상태를 바꾼 사람 */
  status_users: number;
  adds: number;
  status_changes: number;
}

export interface UsageCount {
  key: string;
  count: number;
  users: number;
}

export type ConversionReason = "delay" | "region" | "saved_limit" | "locked_info" | "other" | "none";

export interface ConversionReasonRow {
  reason: ConversionReason;
  /** 구독 직전(30일 안) 마지막으로 걸린 이유가 이것인 전환 수. 합이 전환 수와 같다. */
  last_touch: number;
  /** 구독 전 30일 안에 한 번이라도 이것에 걸린 전환 수 */
  any_touch: number;
  /** 기간 안에 이것에 걸린 무료 이용자 */
  guests: number;
  /** 그중 처음 걸린 뒤 30일 안에 구독한 사람 */
  converted: number;
}

/** 오픈콜 GET /api/admin/usage. 계산 방식은 opencall-server docs/USAGE_STATS.md */
export interface UsageStats {
  unit: "day" | "week" | "month";
  from: string;
  to: string;
  /** 가장 최근 사용 기록 시각. 아직 없으면 null. */
  updated_at: string | null;
  saved: {
    all: SavedTierUsage;
    by_tier: Record<UsageTier, SavedTierUsage>;
    /** 바꾼 뒤 상태별 횟수 (todo·contacted·dealing·hold) */
    status_to: Record<string, number>;
  };
  map: {
    store_views: number;
    view_users: number;
    map_opens: number;
    map_users: number;
    by_source: UsageCount[];
    by_app: UsageCount[];
    views_source: UsageCount[];
    series: { period: string; store_views: number; map_opens: number }[];
  };
  conversion: {
    guest_users: number;
    converted: number;
    trial: number;
    /** 가입부터 구독 시작까지 날 수의 중앙값. 전환이 없으면 null. */
    median_days: number | null;
    days: { label: string; count: number }[];
    reasons: ConversionReasonRow[];
  };
}

export type ContactStatus = "open" | "answered" | "closed";

export const CONTACT_STATUSES: ContactStatus[] = ["open", "answered", "closed"];

export const CONTACT_STATUS_NAMES: Record<ContactStatus, string> = {
  open: "답변 전",
  answered: "답변함",
  closed: "닫음",
};

/** 오픈콜 문의 분류 (opencall-server internal/contact). 모르는 분류는 서버가 준 category_name 을 쓴다. */
export const CONTACT_CATEGORIES: { id: string; name: string }[] = [
  { id: "bug", name: "버그" },
  { id: "suggestion", name: "제안" },
  { id: "question", name: "문의" },
  { id: "payment", name: "결제" },
  { id: "account", name: "계정" },
  { id: "data", name: "데이터 오류" },
  { id: "premium", name: "프리미엄 상담" },
  { id: "other", name: "기타" },
];

/** 오픈콜 문의 한 건. 계산·흐름은 opencall-server docs/CONTACT.md */
export interface Contact {
  id: number;
  category: string;
  category_name?: string;
  message: string;
  status: ContactStatus;
  created_at: string;
  answer?: string;
  answered_at?: string;
  answered_by?: string;
  /** 탈퇴했거나 로그인 없이 남긴 문의는 없다. */
  user_id?: number;
  nickname?: string;
  user_email?: string;
  /** 사용자가 답장 받을 주소로 적은 메일. 있으면 답변이 메일로도 간다. */
  reply_email?: string;
  app_version?: string;
  platform?: string;
  os_version?: string;
  device_model?: string;
  /** 문의를 보낼 때 앱이 붙인 화면 상황 */
  context?: string;
  /** 사용자가 앱에서 답변을 본 시각 */
  user_read_at?: string;
}

export interface ContactList {
  items: Contact[] | null;
  /** 지금 조건에 맞는 전체 수 */
  total: number;
  /** 상태별 전체 수 (조건과 무관) */
  counts: Partial<Record<ContactStatus, number>> | null;
}

export interface ContactReplyResult {
  item: Contact;
  /** 앱 푸시가 한 기기라도 갔는지 */
  push_sent: boolean;
  /** 사용자가 적은 답장 메일로 보냈는지 */
  mail_sent: boolean;
}

/** 오픈콜 GET /api/admin/referrals. 규칙은 opencall-server docs/REFERRAL.md */
export interface ReferralReport {
  /** 가입 수 많은 순 */
  codes: { code: string; count: number; paying: number; last_at: string }[] | null;
  /** 최근 넣은 순. code 로 조회하면 그 코드만 */
  recent:
    | { user_id: number | null; nickname?: string; code: string; entered_at: string; signup_at?: string }[]
    | null;
  /** 코드를 넣은 사람 수 (탈퇴 포함) */
  total: number;
}
