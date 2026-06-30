export type Region = "north_america" | "europe" | "east_asia" | "china";
export type DataFrequency = "annual" | "quarterly" | "monthly" | "daily" | "event";
export type SourceStatus = "pending" | "fresh" | "stale" | "failed" | "unavailable" | "needs_api_key";
export type IndicatorKey = "gdp" | "gdp_real" | "gdp_nominal" | "cpi" | "inflation_rate" | "policy_rate" | "lpr";
export type ObservationRange = "1y" | "5y" | "10y" | "all";
export type ViewFrequency = "raw" | "quarterly";

export interface Country {
  code: string;
  nameZh: string;
  nameEn: string;
  region: Region;
}

export interface Indicator {
  key: IndicatorKey;
  nameZh: string;
  nameEn: string;
  unit: string;
  frequency: DataFrequency;
}

export interface Series {
  id: string;
  countryCode: string;
  indicatorKey: IndicatorKey;
  source: string;
  unit?: string;
  sourceUrl?: string;
  status?: "real" | "unavailable";
  sourceStatus?: SourceStatus;
  providerKey?: string;
  lastSyncedAt?: string;
  nextReleaseDate?: string;
}

export interface ProviderObservation {
  date: string;
  period?: string;
  frequency?: DataFrequency;
  value: number;
  rawValue?: number;
  normalizedValue?: number;
  unit?: string;
  revisionTag?: string;
  source: string;
}

export interface Observation extends ProviderObservation {
  seriesId: string;
  updatedAt: string;
}

export interface ProviderReleaseEvent {
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

export interface ReleaseEvent extends ProviderReleaseEvent {
  id?: string;
  seriesId: string;
  countryCode: string;
  indicatorKey: IndicatorKey;
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
