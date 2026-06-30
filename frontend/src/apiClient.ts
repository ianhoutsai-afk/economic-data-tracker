import { countries, dataProviders, indicators, observations, releases, series } from "./catalogFallback";
import type {
  ApiEnvelope,
  Country,
  DataProvider,
  DashboardPayload,
  Indicator,
  Observation,
  ObservationRange,
  ReleaseEvent,
  Series,
  ViewFrequency
} from "./types";
import type { StaticDashboardSnapshot } from "./types";
import { asStaticDashboardSnapshot, filterStaticDashboard } from "./staticDashboard";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
export const dataMode = import.meta.env.VITE_DATA_MODE === "static" ? "static" : "api";
let staticSnapshotPromise: Promise<StaticDashboardSnapshot> | undefined;

// ==========================================
// Client-side cache for dashboard requests
// ==========================================
const dashboardCache = new Map<string, DashboardPayload>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = new Map<string, number>();

function cacheKey(params: Record<string, string | undefined>): string {
  return JSON.stringify(params);
}

function isCacheValid(key: string): boolean {
  const timestamp = cacheTimestamps.get(key);
  return timestamp !== undefined && (Date.now() - timestamp) < CACHE_TTL_MS;
}

function setCache(key: string, data: DashboardPayload): void {
  dashboardCache.set(key, data);
  cacheTimestamps.set(key, Date.now());
}

async function getJson<T>(path: string, baseUrl = API_BASE_URL): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);

  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    const message = body?.error?.message ?? `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

async function getStaticSnapshot(forceRefresh = false) {
  if (forceRefresh) staticSnapshotPromise = undefined;
  if (!staticSnapshotPromise) {
    const suffix = forceRefresh ? `?v=${Date.now()}` : "";
    staticSnapshotPromise = getJson<unknown>(`${import.meta.env.BASE_URL}data/dashboard.json${suffix}`, "").then(asStaticDashboardSnapshot);
  }
  return staticSnapshotPromise;
}

export const economicApi = {
  async getDashboard(
    params: {
      range?: ObservationRange;
      indicatorKey?: Indicator["key"];
      region?: Country["region"] | "all";
      viewFrequency?: ViewFrequency;
      forceRefresh?: boolean;
    } = {}
  ): Promise<DashboardPayload> {
    const { forceRefresh: _forceRefresh, ...requestParams } = params;
    const key = cacheKey(requestParams as Record<string, string | undefined>);

    // Return cached data if still valid
    if (!_forceRefresh && isCacheValid(key)) {
      const cached = dashboardCache.get(key);
      if (cached) return cached;
    }

    const dashboard = dataMode === "static"
      ? filterStaticDashboard(await getStaticSnapshot(_forceRefresh), requestParams)
      : await getApiDashboard(requestParams);

    // Cache the result
    setCache(key, dashboard);

    return dashboard;
  },

  clearDashboardCache() {
    dashboardCache.clear();
    cacheTimestamps.clear();
  },

  async getCountries(): Promise<Country[]> {
    if (dataMode === "static") return (await getStaticSnapshot()).countries;
    const envelope = await getJson<ApiEnvelope<Country[]>>("/api/v1/countries");
    return envelope.data;
  },
  async getIndicators(): Promise<Indicator[]> {
    if (dataMode === "static") return (await getStaticSnapshot()).indicators;
    const envelope = await getJson<ApiEnvelope<Indicator[]>>("/api/v1/indicators");
    return envelope.data;
  },
  async getSeries(): Promise<Series[]> {
    if (dataMode === "static") return (await getStaticSnapshot()).series;
    const envelope = await getJson<ApiEnvelope<Series[]>>("/api/v1/series");
    return envelope.data;
  },
  async getObservations(
    params: { range?: ObservationRange; indicatorKey?: Indicator["key"]; countryCode?: string; viewFrequency?: ViewFrequency } = {}
  ): Promise<Observation[]> {
    if (dataMode === "static") {
      return filterStaticDashboard(await getStaticSnapshot(), params).observations;
    }
    const search = new URLSearchParams();
    if (params.range) search.set("range", params.range);
    if (params.indicatorKey) search.set("indicatorKey", params.indicatorKey);
    if (params.countryCode) search.set("countryCode", params.countryCode);
    if (params.viewFrequency) search.set("viewFrequency", params.viewFrequency);

    const query = search.size > 0 ? `?${search.toString()}` : "";
    const envelope = await getJson<ApiEnvelope<Observation[]>>(`/api/v1/observations${query}`);
    return envelope.data;
  },
  async getReleases(params: { range?: ObservationRange; indicatorKey?: Indicator["key"]; countryCode?: string } = {}): Promise<ReleaseEvent[]> {
    if (dataMode === "static") {
      const snapshot = await getStaticSnapshot();
      const filtered = filterStaticDashboard(snapshot, params);
      return params.countryCode
        ? filtered.releases.filter((item) => item.countryCode === params.countryCode)
        : filtered.releases;
    }
    const search = new URLSearchParams();
    if (params.range) search.set("range", params.range);
    if (params.indicatorKey) search.set("indicatorKey", params.indicatorKey);
    if (params.countryCode) search.set("countryCode", params.countryCode);

    const query = search.size > 0 ? `?${search.toString()}` : "";
    const envelope = await getJson<ApiEnvelope<ReleaseEvent[]>>(`/api/v1/releases${query}`);
    return envelope.data;
  },
  async getProviders(): Promise<DataProvider[]> {
    if (dataMode === "static") return (await getStaticSnapshot()).providers;
    const envelope = await getJson<ApiEnvelope<DataProvider[]>>("/api/v1/providers");
    return envelope.data;
  }
};

async function getApiDashboard(params: {
  range?: ObservationRange;
  indicatorKey?: Indicator["key"];
  region?: Country["region"] | "all";
  viewFrequency?: ViewFrequency;
}) {
  const search = new URLSearchParams();
  if (params.range) search.set("range", params.range);
  if (params.indicatorKey) search.set("indicatorKey", params.indicatorKey);
  if (params.region) search.set("region", params.region);
  if (params.viewFrequency) search.set("viewFrequency", params.viewFrequency);

  const query = search.size > 0 ? `?${search.toString()}` : "";
  const envelope = await getJson<ApiEnvelope<DashboardPayload>>(`/api/v1/dashboard${query}`);
  return envelope.data;
}

export const fallbackData = {
  countries,
  indicators,
  series,
  observations,
  releases,
  providers: dataProviders,
  dataQualityWarnings: []
};
