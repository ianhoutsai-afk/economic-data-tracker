import { countries, dataProviders, indicators, series as catalogSeries } from "../data/catalog.js";
import type {
  DataProvider,
  DataQualityWarning,
  Observation,
  ProviderReleaseEvent,
  ReleaseEvent,
  Series,
  StaticDashboardSnapshot,
  StaticSeriesSyncState
} from "../types.js";
import { fetchSeriesData, isProviderConfigured, type ProviderPayload } from "./providers.js";
import { nextReleaseDate } from "./releaseSchedule.js";

export type StaticSnapshotMode = "due" | "full";

type FetchSeriesData = typeof fetchSeriesData;

export type StaticSnapshotBuildOptions = {
  mode: StaticSnapshotMode;
  now?: Date;
  previous?: StaticDashboardSnapshot;
  historyYears?: number;
  fetcher?: FetchSeriesData;
};

export type StaticSnapshotBuildResult = {
  snapshot: StaticDashboardSnapshot;
  attemptedSeries: number;
  updatedSeries: number;
  failedSeries: string[];
};

const maxAutomaticRetries = 3;

export async function buildStaticSnapshot(options: StaticSnapshotBuildOptions): Promise<StaticSnapshotBuildResult> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const previous = options.previous;
  const mode = previous ? options.mode : "full";
  const fetcher = options.fetcher ?? fetchSeriesData;
  const historyYears = options.historyYears ?? 10;
  const snapshot = baseSnapshot(previous, nowIso);
  const targets = catalogSeries.filter((item) => item.status === "real" && (mode === "full" || isSeriesDue(item, snapshot, now)));

  if (targets.length === 0 && previous) {
    return { snapshot: previous, attemptedSeries: 0, updatedSeries: 0, failedSeries: [] };
  }

  let updatedSeries = 0;
  const failedSeries: string[] = [];

  for (const item of targets) {
    const previousState = snapshot.syncState[item.id] ?? { retryCount: 0 };
    const hasPreviousData = snapshot.observations.some((observation) => observation.seriesId === item.id);

    if (!isProviderConfigured(item)) {
      snapshot.syncState[item.id] = {
        ...previousState,
        lastAttemptAt: nowIso,
        nextReleaseDate: nextReleaseDate(item, now).toISOString(),
        retryCount: 0,
        errorMessage: "API key is required"
      };
      updateSeriesMetadata(snapshot, item.id, {
        sourceStatus: hasPreviousData ? "stale" : "needs_api_key",
        nextReleaseDate: snapshot.syncState[item.id].nextReleaseDate
      });
      continue;
    }

    try {
      const payload = await fetcher(item, {
        mode: mode === "full" ? "history" : "incremental",
        lookbackYears: historyYears,
        now
      });
      const changed = payloadChangesSeries(snapshot, item, payload);

      if (mode === "due" && hasPreviousData && !changed) {
        recordFailure(snapshot, item, previousState, now, "Source has not published a new value yet");
        failedSeries.push(item.id);
        continue;
      }
      if (payload.observations.length === 0 && payload.releases.length === 0) {
        recordFailure(snapshot, item, previousState, now, "Source returned no observations");
        failedSeries.push(item.id);
        continue;
      }

      mergeProviderPayload(snapshot, item, payload, nowIso, mode);
      const next = nextReleaseDate(item, now).toISOString();
      snapshot.syncState[item.id] = {
        lastAttemptAt: nowIso,
        lastSuccessAt: nowIso,
        nextReleaseDate: next,
        retryCount: 0
      };
      updateSeriesMetadata(snapshot, item.id, {
        sourceStatus: payload.sourceStatus,
        lastSyncedAt: nowIso,
        nextReleaseDate: next
      });
      updatedSeries += changed ? 1 : 0;
    } catch (error) {
      const message = sanitizeProviderError(error);
      recordFailure(snapshot, item, previousState, now, message);
      failedSeries.push(item.id);
    }
  }

  snapshot.generatedAt = nowIso;
  snapshot.providers = providerStatuses(snapshot, nowIso);
  sortSnapshot(snapshot);

  return {
    snapshot,
    attemptedSeries: targets.length,
    updatedSeries,
    failedSeries
  };
}

export function isStaticDashboardSnapshot(value: unknown): value is StaticDashboardSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StaticDashboardSnapshot>;
  return (
    candidate.snapshotVersion === 1 &&
    typeof candidate.generatedAt === "string" &&
    Array.isArray(candidate.countries) &&
    Array.isArray(candidate.indicators) &&
    Array.isArray(candidate.series) &&
    Array.isArray(candidate.observations) &&
    Array.isArray(candidate.releases) &&
    Array.isArray(candidate.providers) &&
    Array.isArray(candidate.dataQualityWarnings) &&
    Boolean(candidate.syncState) &&
    typeof candidate.syncState === "object"
  );
}

export function sanitizeProviderError(error: unknown) {
  let message = error instanceof Error ? error.message : "Unknown provider error";
  const secretNames = ["FRED_API_KEY", "ESTAT_APP_ID", "BEA_API_KEY"];

  for (const name of secretNames) {
    const value = process.env[name];
    if (value) message = message.split(value).join("[redacted]");
  }

  return message.replace(/([?&](?:api_?key|apikey|app_?id|appid)=)[^&\s]+/gi, "$1[redacted]");
}

function baseSnapshot(previous: StaticDashboardSnapshot | undefined, generatedAt: string): StaticDashboardSnapshot {
  const previousSeries = new Map((previous?.series ?? []).map((item) => [item.id, item]));
  return {
    snapshotVersion: 1,
    generatedAt,
    countries: structuredClone(countries),
    indicators: structuredClone(indicators),
    series: catalogSeries.map((item) => ({ ...item, ...previousSeries.get(item.id), status: item.status, providerKey: item.providerKey })),
    observations: structuredClone(previous?.observations ?? []),
    releases: structuredClone(previous?.releases ?? []),
    providers: structuredClone(previous?.providers ?? dataProviders),
    dataQualityWarnings: structuredClone(previous?.dataQualityWarnings ?? []),
    syncState: structuredClone(previous?.syncState ?? {})
  };
}

function isSeriesDue(series: Series, snapshot: StaticDashboardSnapshot, now: Date) {
  const configured = snapshot.syncState[series.id]?.nextReleaseDate ?? snapshot.series.find((item) => item.id === series.id)?.nextReleaseDate;
  if (!configured) return true;
  const date = new Date(configured);
  return !Number.isFinite(date.getTime()) || date <= now;
}

function payloadChangesSeries(snapshot: StaticDashboardSnapshot, series: Series, payload: ProviderPayload) {
  const existingObservations = snapshot.observations.filter((item) => item.seriesId === series.id);
  const existingReleases = snapshot.releases.filter((item) => item.seriesId === series.id);

  return (
    payload.observations.some((item) => {
      const previous = existingObservations.find((candidate) => observationDataIdentity(candidate) === observationDataIdentity(item));
      return !previous || observationValueSignature(previous) !== providerObservationValueSignature(item);
    }) ||
    payload.releases.some((item) => {
      const previous = existingReleases.find((candidate) => releaseDataIdentity(candidate) === releaseDataIdentity(item));
      return !previous || releaseValueSignature(previous) !== providerReleaseValueSignature(item);
    })
  );
}

function mergeProviderPayload(
  snapshot: StaticDashboardSnapshot,
  series: Series,
  payload: ProviderPayload,
  updatedAt: string,
  mode: StaticSnapshotMode
) {
  const incomingObservations: Observation[] = payload.observations.map((item) => ({
    ...item,
    seriesId: series.id,
    updatedAt
  }));
  const existingObservations = mode === "full"
    ? snapshot.observations.filter((item) => item.seriesId !== series.id)
    : snapshot.observations;
  snapshot.observations = mergeByIdentity(existingObservations, incomingObservations, observationIdentity);

  const incomingReleases = payload.releases.map((item) => releaseFromProvider(series, item));
  const existingReleases = mode === "full"
    ? snapshot.releases.filter((item) => item.seriesId !== series.id)
    : snapshot.releases;
  snapshot.releases = mergeByIdentity(existingReleases, incomingReleases, releaseIdentity);

  const incomingWarnings: DataQualityWarning[] = (payload.comparisonWarnings ?? []).map((item) => ({
    seriesId: series.id,
    ...item
  }));
  snapshot.dataQualityWarnings = [
    ...snapshot.dataQualityWarnings.filter((item) => item.seriesId !== series.id),
    ...incomingWarnings
  ];
}

function recordFailure(
  snapshot: StaticDashboardSnapshot,
  series: Series,
  previousState: StaticSeriesSyncState,
  now: Date,
  errorMessage: string
) {
  const retryCount = (previousState.retryCount ?? 0) + 1;
  const hasPreviousData = snapshot.observations.some((observation) => observation.seriesId === series.id);
  const next = retryCount < maxAutomaticRetries ? nextRetryDate(now) : nextReleaseDate(series, now);

  snapshot.syncState[series.id] = {
    ...previousState,
    lastAttemptAt: now.toISOString(),
    nextReleaseDate: next.toISOString(),
    retryCount,
    errorMessage
  };
  updateSeriesMetadata(snapshot, series.id, {
    sourceStatus: hasPreviousData ? "stale" : "failed",
    nextReleaseDate: next.toISOString()
  });
}

function updateSeriesMetadata(snapshot: StaticDashboardSnapshot, seriesId: string, patch: Partial<Series>) {
  snapshot.series = snapshot.series.map((item) => (item.id === seriesId ? { ...item, ...patch } : item));
}

function providerStatuses(snapshot: StaticDashboardSnapshot, checkedAt: string): DataProvider[] {
  return dataProviders.map((provider) => {
    const providerSeries = snapshot.series.filter((item) => item.providerKey === provider.key);
    if (providerSeries.length === 0) return { ...provider };

    const statuses = new Set(providerSeries.map((item) => item.sourceStatus));
    const errors = providerSeries
      .map((item) => snapshot.syncState[item.id]?.errorMessage)
      .filter((message): message is string => Boolean(message));
    const status = statuses.has("failed")
      ? "failed"
      : statuses.has("stale")
        ? "stale"
        : statuses.has("fresh")
          ? "fresh"
          : statuses.has("needs_api_key")
            ? "needs_api_key"
            : provider.status;

    return {
      ...provider,
      status,
      lastCheckedAt: checkedAt,
      errorMessage: errors[0]
    };
  });
}

function releaseFromProvider(series: Series, release: ProviderReleaseEvent): ReleaseEvent {
  return {
    seriesId: series.id,
    countryCode: series.countryCode,
    indicatorKey: series.indicatorKey,
    ...release
  };
}

function mergeByIdentity<T>(existing: T[], incoming: T[], identity: (item: T) => string) {
  const merged = new Map(existing.map((item) => [identity(item), item]));
  incoming.forEach((item) => merged.set(identity(item), item));
  return Array.from(merged.values());
}

function observationIdentity(item: Pick<Observation, "seriesId" | "date" | "period">) {
  return `${item.seriesId}:${observationDataIdentity(item)}`;
}

function observationDataIdentity(item: { date: string; period?: string }) {
  return item.period ?? item.date.slice(0, 10);
}

function observationValueSignature(item: Observation) {
  return JSON.stringify([item.value, item.rawValue, item.normalizedValue, item.revisionTag, item.source, item.unit]);
}

function providerObservationValueSignature(item: ProviderPayload["observations"][number]) {
  return JSON.stringify([item.value, item.rawValue, item.normalizedValue, item.revisionTag, item.source, item.unit]);
}

function releaseIdentity(item: Pick<ReleaseEvent, "seriesId" | "eventType" | "date" | "period">) {
  return `${item.seriesId}:${releaseDataIdentity(item)}`;
}

function releaseDataIdentity(item: { eventType: string; date: string; period?: string }) {
  return `${item.eventType}:${item.period ?? item.date.slice(0, 10)}`;
}

function releaseValueSignature(item: ReleaseEvent) {
  return JSON.stringify([item.actual, item.previous, item.forecast, item.consensus, item.source]);
}

function providerReleaseValueSignature(item: ProviderReleaseEvent) {
  return JSON.stringify([item.actual, item.previous, item.forecast, item.consensus, item.source]);
}

function nextRetryDate(now: Date) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function sortSnapshot(snapshot: StaticDashboardSnapshot) {
  snapshot.observations.sort((a, b) => a.seriesId.localeCompare(b.seriesId) || a.date.localeCompare(b.date));
  snapshot.releases.sort((a, b) => a.seriesId.localeCompare(b.seriesId) || a.date.localeCompare(b.date));
  snapshot.series.sort((a, b) => a.countryCode.localeCompare(b.countryCode) || a.indicatorKey.localeCompare(b.indicatorKey));
}
