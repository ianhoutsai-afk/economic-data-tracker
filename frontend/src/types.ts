export type Region = "north_america" | "europe" | "east_asia" | "china";
export type DataFrequency = "annual" | "quarterly" | "monthly" | "daily" | "event";
export type SourceStatus = "pending" | "fresh" | "stale" | "failed" | "unavailable" | "needs_api_key";

export interface Country {
  code: string;
  nameZh: string;
  nameEn: string;
  region: Region;
}

export interface Indicator {
  key: "gdp" | "gdp_real" | "gdp_nominal" | "cpi" | "inflation_rate" | "policy_rate" | "lpr";
  nameZh: string;
  nameEn: string;
  unit: string;
  frequency: DataFrequency;
}

export interface Series {
  id: string;
  countryCode: string;
  indicatorKey: Indicator["key"];
  source: string;
  unit?: string;
  sourceUrl?: string;
  status?: "real" | "unavailable";
  sourceStatus?: SourceStatus;
  providerKey?: string;
  lastSyncedAt?: string;
  nextReleaseDate?: string;
}

export interface Observation {
  seriesId: string;
  date: string;
  period?: string;
  frequency?: DataFrequency;
  value: number;
  rawValue?: number;
  normalizedValue?: number;
  unit?: string;
  revisionTag?: string;
  source: string;
  updatedAt: string;
}

export interface ApiEnvelope<T> {
  data: T;
}

export type ObservationRange = "1y" | "5y" | "10y" | "all";
export type ViewFrequency = "raw" | "quarterly";

export interface ReleaseEvent {
  id?: string;
  seriesId: string;
  countryCode: string;
  indicatorKey: Indicator["key"];
  eventType: "gdp_release" | "cpi_release" | "inflation_release" | "rate_decision";
  date: string;
  period?: string;
  actual?: number;
  previous?: number;
  forecast?: number;
  consensus?: number;
  source: string;
  sourceUrl?: string;
}

export interface DataProvider {
  key: string;
  name: string;
  sourceUrl?: string;
  priority: number;
  requiresApiKey: boolean;
  registrationUrl?: string;
  status: SourceStatus;
  coverage?: string;
  lastCheckedAt?: string;
  errorMessage?: string;
}

export interface DataQualityWarning {
  seriesId: string;
  period: string;
  primarySource: string;
  comparisonSource: string;
  primaryValue: number;
  comparisonValue: number;
  difference: number;
}

export interface DashboardPayload {
  countries: Country[];
  indicators: Indicator[];
  series: Series[];
  observations: Observation[];
  releases: ReleaseEvent[];
  providers: DataProvider[];
  dataQualityWarnings: DataQualityWarning[];
  snapshotVersion?: 1;
  generatedAt?: string;
  syncState?: Record<string, StaticSeriesSyncState>;
}

export interface StaticSeriesSyncState {
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  nextReleaseDate?: string;
  retryCount: number;
  errorMessage?: string;
}

export interface StaticDashboardSnapshot extends DashboardPayload {
  snapshotVersion: 1;
  generatedAt: string;
  syncState: Record<string, StaticSeriesSyncState>;
}
