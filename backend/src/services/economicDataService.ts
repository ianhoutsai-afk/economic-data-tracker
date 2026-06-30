import { countries, dataProviders, indicators, series as catalogSeries, unitForSeries } from "../data/catalog.js";
import { hasDatabase, prisma } from "../db/prisma.js";
import type {
  DashboardPayload,
  Country,
  DataProvider,
  DataQualityWarning,
  Indicator,
  IndicatorKey,
  Observation,
  ObservationRange,
  ProviderReleaseEvent,
  Region,
  ReleaseEvent,
  Series,
  SourceStatus,
  ViewFrequency
} from "../types.js";
import { filterObservationsByDate } from "./dateRange.js";
import { fetchSeriesData, isProviderConfigured } from "./providers.js";

type SeriesFilters = {
  countryCode?: string;
  indicatorKey?: IndicatorKey;
};

type ObservationFilters = SeriesFilters & {
  seriesId?: string;
  from?: string;
  to?: string;
  range?: ObservationRange;
  viewFrequency?: ViewFrequency;
};

type ReleaseFilters = SeriesFilters & {
  range?: ObservationRange;
  from?: string;
  to?: string;
};

type DashboardFilters = ObservationFilters & {
  region?: Region | "all";
};

export const economicDataService = {
  async listCountries() {
    if (!canUseDatabase()) return countries;
    try {
      await ensureCatalog();
      const rows = await db().country.findMany({ orderBy: { code: "asc" } });
      return rows.map(toCountry);
    } catch (error) {
      warnDbFallback("countries", error);
      return countries;
    }
  },

  async listIndicators() {
    if (!canUseDatabase()) return indicators;
    try {
      await ensureCatalog();
      const rows = await db().indicator.findMany({ orderBy: { key: "asc" } });
      return rows.map(toIndicator);
    } catch (error) {
      warnDbFallback("indicators", error);
      return indicators;
    }
  },

  async listSeries(filters: SeriesFilters = {}) {
    return listSeriesFromStore(filters);
  },

  async listObservations(filters: ObservationFilters = {}) {
    if (!canUseDatabase()) {
      return liveObservations(filters);
    }

    try {
      await ensureCatalog();
      const allowedSeriesIds = filters.seriesId
        ? [filters.seriesId]
        : (await listSeriesFromStore({ countryCode: filters.countryCode, indicatorKey: filters.indicatorKey })).map((item) => item.id);

      if (allowedSeriesIds.length === 0) return [];

      const rows = await db().observation.findMany({
        where: {
          seriesId: { in: allowedSeriesIds },
          date: dateWhere(filters)
        },
        orderBy: { date: "asc" }
      });

      const observations = withObservationUnits(
        applyViewFrequency(filterObservationsByDate(rows.map(toObservation).filter(isDisplayObservation), filters), filters.viewFrequency)
      );
      return observations.length > 0 ? observations : liveObservations(filters);
    } catch (error) {
      warnDbFallback("observations", error);
      return liveObservations(filters);
    }
  },

  async listReleases(filters: ReleaseFilters = {}) {
    if (!canUseDatabase()) {
      return liveReleases(filters);
    }

    try {
      await ensureCatalog();
      const allowedSeriesIds = (await listSeriesFromStore({ countryCode: filters.countryCode, indicatorKey: filters.indicatorKey })).map(
        (item) => item.id
      );
      if (allowedSeriesIds.length === 0) return [];

      const rows = await db().releaseEvent.findMany({
        where: {
          seriesId: { in: allowedSeriesIds },
          date: dateWhere(filters)
        },
        orderBy: { date: "asc" }
      });
      const releases = filterReleasesByDate(rows.map(toRelease).filter(isDisplayRelease), filters);
      return releases.length > 0 ? releases : liveReleases(filters);
    } catch (error) {
      warnDbFallback("releases", error);
      return liveReleases(filters);
    }
  },

  async listProviders() {
    if (!canUseDatabase()) return dataProviders;
    try {
      await ensureCatalog();
      const rows = await db().dataProvider.findMany({ orderBy: { priority: "asc" } });
      return rows.map((row) => normalizeProviderStatus({
        key: String(row.key),
        name: String(row.name),
        sourceUrl: row.sourceUrl ? String(row.sourceUrl) : undefined,
        priority: Number(row.priority),
        requiresApiKey: Boolean(row.requiresApiKey),
        registrationUrl: row.registrationUrl ? String(row.registrationUrl) : undefined,
        status: asSourceStatus(row.status),
        coverage: row.coverage ? String(row.coverage) : undefined,
        lastCheckedAt: row.lastCheckedAt instanceof Date ? row.lastCheckedAt.toISOString() : undefined,
        errorMessage: row.errorMessage ? String(row.errorMessage) : undefined
      }));
    } catch (error) {
      warnDbFallback("providers", error);
      return dataProviders;
    }
  },

  async getDashboard(filters: DashboardFilters = {}): Promise<DashboardPayload> {
    const [allCountries, allIndicators, providers] = await Promise.all([this.listCountries(), this.listIndicators(), this.listProviders()]);
    const allowedCountryCodes = new Set(
      allCountries.filter((country) => !filters.region || filters.region === "all" || country.region === filters.region).map((country) => country.code)
    );
    const series = (await listSeriesFromStore({ indicatorKey: filters.indicatorKey, countryCode: filters.countryCode }))
      .filter((item) => allowedCountryCodes.has(item.countryCode))
      .map(normalizeSeriesStatus);

    const dbData = await dashboardDataFromDb(series, filters);
    const data = dbData ?? (liveProviderFallbackEnabled() ? await liveDataForSeries(series.filter((item) => item.status !== "unavailable"), filters) : emptyDashboardData());

    return {
      countries: allCountries,
      indicators: allIndicators,
      series,
      observations: withObservationUnits(data.observations),
      releases: data.releases,
      providers,
      dataQualityWarnings: data.dataQualityWarnings
    };
  },

  ensureCatalog
};

async function listSeriesFromStore(filters: SeriesFilters = {}) {
  if (!canUseDatabase()) return filterSeries(catalogSeries, filters).map(normalizeSeriesStatus);
  try {
    await ensureCatalog();

    const rows = await db().series.findMany({
      where: {
        countryCode: filters.countryCode,
        indicatorKey: filters.indicatorKey
      },
      orderBy: [{ countryCode: "asc" }, { indicatorKey: "asc" }]
    });

    return rows.map(toSeries).map(normalizeSeriesStatus);
  } catch (error) {
    warnDbFallback("series", error);
    return filterSeries(catalogSeries, filters).map(normalizeSeriesStatus);
  }
}

function filterSeries(items: Series[], filters: SeriesFilters) {
  return items.filter((item) => {
    if (filters.countryCode && item.countryCode !== filters.countryCode) return false;
    if (filters.indicatorKey && item.indicatorKey !== filters.indicatorKey) return false;
    return true;
  });
}

let catalogReady = false;
let databaseUnavailable = false;

async function ensureCatalog() {
  if (!canUseDatabase() || catalogReady) return;

  const client = db();
  await Promise.all(
    countries.map((country) =>
      client.country.upsert({
        where: { code: country.code },
        update: country,
        create: country
      })
    )
  );

  await Promise.all(
    indicators.map((indicator) =>
      client.indicator.upsert({
        where: { key: indicator.key },
        update: indicator,
        create: indicator
      })
    )
  );

  await Promise.all(
    dataProviders.map((provider) =>
      client.dataProvider.upsert({
        where: { key: provider.key },
        update: provider,
        create: provider
      })
    )
  );

  await cleanupObsoleteEuropeanCatalogEntries(client);
  await cleanupDeprecatedCatalogSeries(client);

  await Promise.all(
    catalogSeries.map((item) =>
      client.series.upsert({
        where: { id: item.id },
        update: {
          countryCode: item.countryCode,
          indicatorKey: item.indicatorKey,
          source: item.source,
          sourceUrl: item.sourceUrl,
          status: item.status ?? "real",
          sourceStatus: item.sourceStatus ?? "pending",
          providerKey: item.providerKey
        },
        create: {
          id: item.id,
          countryCode: item.countryCode,
          indicatorKey: item.indicatorKey,
          source: item.source,
          sourceUrl: item.sourceUrl,
          status: item.status ?? "real",
          sourceStatus: item.sourceStatus ?? "pending",
          providerKey: item.providerKey
        }
      })
    )
  );

  catalogReady = true;
}

async function cleanupObsoleteEuropeanCatalogEntries(client: ReturnType<typeof db>) {
  const currentCountryCodes = countries.map((country) => country.code);
  const obsoleteEuropeanCountries = await client.country.findMany({
    where: {
      region: "europe",
      code: { notIn: currentCountryCodes }
    }
  });
  const obsoleteCountryCodes = obsoleteEuropeanCountries.map((country) => String(country.code));
  if (obsoleteCountryCodes.length === 0) return;

  await client.series.deleteMany({ where: { countryCode: { in: obsoleteCountryCodes } } });
  await client.country.deleteMany({ where: { code: { in: obsoleteCountryCodes } } });
}

async function cleanupDeprecatedCatalogSeries(client: ReturnType<typeof db>) {
  await client.series.deleteMany({ where: { id: { in: ["CN-policy_rate"] } } });
}

function dateWhere(filters: ObservationFilters) {
  if (!filters.from && !filters.to) return undefined;

  return {
    gte: filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : undefined,
    lte: filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : undefined
  };
}

async function liveObservations(filters: ObservationFilters) {
  if (!liveProviderFallbackEnabled()) return [];

  return (await liveDataForSeries(liveSeries(filters), filters)).observations;
}

async function liveReleases(filters: ReleaseFilters) {
  if (!liveProviderFallbackEnabled()) return [];

  return (await liveDataForSeries(liveSeries(filters), filters)).releases;
}

async function liveDataForSeries(seriesItems: Series[], filters: ObservationFilters | ReleaseFilters) {
  const rows: ReleaseEvent[] = [];
  const observations: Observation[] = [];
  const dataQualityWarnings: DataQualityWarning[] = [];
  const updatedAt = new Date().toISOString();

  const payloads = await mapWithConcurrency(seriesItems, 4, async (item) => ({
    item,
    payload: await fetchLiveSeries(item, filters)
  }));

  for (const { item, payload } of payloads) {
    if (!payload) continue;
    rows.push(...payload.releases.map((release) => releaseFromProviderRelease(item, release)));
    observations.push(
      ...payload.observations.map((point) => ({
        ...point,
        seriesId: item.id,
        unit: point.unit ?? item.unit ?? unitForSeries(item.countryCode, item.indicatorKey),
        updatedAt
      }))
    );
    dataQualityWarnings.push(
      ...(payload.comparisonWarnings ?? []).map((warning) => ({
        seriesId: item.id,
        ...warning
      }))
    );
  }

  return {
    observations: withObservationUnits(
      applyViewFrequency(filterObservationsByDate(observations.filter(isDisplayObservation), filters), "viewFrequency" in filters ? filters.viewFrequency : undefined)
    ),
    releases: filterReleasesByDate(rows.filter(isDisplayRelease), filters),
    dataQualityWarnings
  };
}

function liveSeries(filters: SeriesFilters & { seriesId?: string }) {
  return filterSeries(catalogSeries, filters).filter((item) => item.status !== "unavailable" && (!filters.seriesId || item.id === filters.seriesId));
}

async function fetchLiveSeries(series: Series, filters: { range?: ObservationRange }) {
  try {
    return await fetchSeriesData(series, liveFetchOptions(filters));
  } catch (error) {
    console.warn(`Live provider skipped for ${series.id}: ${error instanceof Error ? error.message : "unknown provider error"}`);
    return undefined;
  }
}

function liveFetchOptions(filters: { range?: ObservationRange }) {
  const lookbackYears = filters.range === "1y" ? 1 : filters.range === "5y" || !filters.range ? 5 : filters.range === "10y" ? 10 : 30;
  return {
    mode: filters.range === "all" ? "incremental" : "history",
    lookbackYears,
    now: new Date()
  } as const;
}

function releaseFromProviderRelease(series: Series, release: ProviderReleaseEvent): ReleaseEvent {
  return {
    seriesId: series.id,
    countryCode: series.countryCode,
    indicatorKey: series.indicatorKey,
    ...release
  };
}

function liveProviderFallbackEnabled() {
  return process.env.ENABLE_LIVE_PROVIDER_FALLBACK !== "false";
}

function emptyDashboardData() {
  return {
    observations: [],
    releases: [],
    dataQualityWarnings: []
  };
}

function isDisplayObservation(observation: Observation) {
  return !observation.source.toLowerCase().includes("world bank");
}

function isDisplayRelease(release: ReleaseEvent) {
  return !release.source.toLowerCase().includes("world bank");
}

async function dashboardDataFromDb(seriesItems: Series[], filters: DashboardFilters) {
  if (!canUseDatabase() || seriesItems.length === 0) return undefined;

  try {
    await ensureCatalog();
    const allowedSeriesIds = seriesItems.map((item) => item.id);
    const rows = await db().observation.findMany({
      where: {
        seriesId: { in: allowedSeriesIds },
        date: dateWhere(filters)
      },
      orderBy: { date: "asc" }
    });
    const observations = withObservationUnits(
      applyViewFrequency(filterObservationsByDate(rows.map(toObservation).filter(isDisplayObservation), filters), filters.viewFrequency)
    );
    if (observations.length === 0) return undefined;

    const releaseRows = await db().releaseEvent.findMany({
      where: {
        seriesId: { in: allowedSeriesIds },
        date: dateWhere(filters)
      },
      orderBy: { date: "asc" }
    });

    return {
      observations,
      releases: filterReleasesByDate(releaseRows.map(toRelease).filter(isDisplayRelease), filters),
      dataQualityWarnings: []
    };
  } catch (error) {
    warnDbFallback("dashboard", error);
    return undefined;
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function normalizeSeriesStatus(series: Series): Series {
  const enriched = withSeriesUnit(series);
  if (enriched.sourceStatus !== "needs_api_key" || !isProviderConfigured(enriched)) return enriched;
  return {
    ...enriched,
    sourceStatus: "pending"
  };
}

function normalizeProviderStatus(provider: DataProvider): DataProvider {
  if (provider.status !== "needs_api_key") return provider;

  const configured =
    (provider.key === "fred" && Boolean(process.env.FRED_API_KEY)) ||
    (provider.key === "estat" && Boolean(process.env.ESTAT_APP_ID));

  return configured ? { ...provider, status: "pending" } : provider;
}

function warnDbFallback(scope: string, error: unknown) {
  databaseUnavailable = true;
  console.warn(`Database unavailable for ${scope}; using live/catalog fallback: ${error instanceof Error ? error.message : "unknown database error"}`);
}

function canUseDatabase() {
  return hasDatabase() && !databaseUnavailable;
}

function toCountry(row: Record<string, unknown>): Country {
  return {
    code: String(row.code),
    nameZh: String(row.nameZh),
    nameEn: String(row.nameEn),
    region: row.region as Region
  };
}

function toIndicator(row: Record<string, unknown>): Indicator {
  return {
    key: row.key as IndicatorKey,
    nameZh: String(row.nameZh),
    nameEn: String(row.nameEn),
    unit: String(row.unit),
    frequency: String(row.frequency) as Indicator["frequency"]
  };
}

function toSeries(row: Record<string, unknown>): Series {
  return withSeriesUnit({
    id: String(row.id),
    countryCode: String(row.countryCode),
    indicatorKey: row.indicatorKey as IndicatorKey,
    source: String(row.source),
    sourceUrl: row.sourceUrl ? String(row.sourceUrl) : undefined,
    status: row.status === "unavailable" ? "unavailable" : "real",
    sourceStatus: typeof row.sourceStatus === "string" ? (row.sourceStatus as Series["sourceStatus"]) : undefined,
    providerKey: row.providerKey ? String(row.providerKey) : undefined,
    lastSyncedAt: row.lastSyncedAt instanceof Date ? row.lastSyncedAt.toISOString() : undefined,
    nextReleaseDate: row.nextReleaseDate instanceof Date ? row.nextReleaseDate.toISOString() : undefined
  });
}

function asSourceStatus(value: unknown): SourceStatus {
  if (
    value === "pending" ||
    value === "fresh" ||
    value === "stale" ||
    value === "failed" ||
    value === "unavailable" ||
    value === "needs_api_key"
  ) {
    return value;
  }

  return "pending";
}

function toObservation(row: Record<string, unknown>): Observation {
  return {
    seriesId: String(row.seriesId),
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
    period: row.period ? String(row.period) : undefined,
    frequency: row.frequency ? (String(row.frequency) as Observation["frequency"]) : undefined,
    value: Number(row.value),
    rawValue: row.rawValue === null || row.rawValue === undefined ? undefined : Number(row.rawValue),
    normalizedValue: row.normalizedValue === null || row.normalizedValue === undefined ? undefined : Number(row.normalizedValue),
    unit: typeof row.unit === "string" ? row.unit : undefined,
    revisionTag: row.revisionTag ? String(row.revisionTag) : undefined,
    source: String(row.source),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt)
  };
}

function withSeriesUnit(series: Series): Series {
  return {
    ...series,
    unit: series.unit ?? unitForSeries(series.countryCode, series.indicatorKey)
  };
}

function withObservationUnits(observations: Observation[]) {
  return observations.map((item) => {
    if (item.unit) return item;
    const series = catalogSeries.find((candidate) => candidate.id === item.seriesId);
    return {
      ...item,
      unit: series?.unit ?? (series ? unitForSeries(series.countryCode, series.indicatorKey) : undefined)
    };
  });
}

function toRelease(row: Record<string, unknown>): ReleaseEvent {
  return {
    id: String(row.id),
    seriesId: String(row.seriesId),
    countryCode: String(row.countryCode),
    indicatorKey: row.indicatorKey as IndicatorKey,
    eventType: row.eventType as ReleaseEvent["eventType"],
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
    period: row.period ? String(row.period) : undefined,
    actual: row.actual === null || row.actual === undefined ? undefined : Number(row.actual),
    previous: row.previous === null || row.previous === undefined ? undefined : Number(row.previous),
    forecast: row.forecast === null || row.forecast === undefined ? undefined : Number(row.forecast),
    consensus: row.consensus === null || row.consensus === undefined ? undefined : Number(row.consensus),
    source: String(row.source),
    sourceUrl: row.sourceUrl ? String(row.sourceUrl) : undefined
  };
}

function applyViewFrequency(observations: Observation[], viewFrequency: ViewFrequency | undefined) {
  if (viewFrequency !== "quarterly") return observations;

  const bySeriesQuarter = new Map<string, { sourceDate: string; observation: Observation }>();
  observations.forEach((item) => {
    const quarter = `${item.date.slice(0, 4)}-Q${Math.ceil(Number(item.date.slice(5, 7)) / 3)}`;
    const key = `${item.seriesId}:${quarter}`;
    const previous = bySeriesQuarter.get(key);
    if (!previous || item.date > previous.sourceDate) {
      bySeriesQuarter.set(key, {
        sourceDate: item.date,
        observation: {
          ...item,
          date: quarterEndDate(quarter),
          period: quarter,
          frequency: "quarterly"
        }
      });
    }
  });

  return Array.from(bySeriesQuarter.values())
    .map((item) => item.observation)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function quarterEndDate(quarter: string) {
  const [year, rawQuarter] = quarter.split("-Q");
  return `${year}-${["03-31", "06-30", "09-30", "12-31"][Number(rawQuarter) - 1]}`;
}

function filterReleasesByDate(releases: ReleaseEvent[], filters: ReleaseFilters) {
  const observations = releases.map((release) => ({
    seriesId: release.seriesId,
    date: release.date,
    value: release.actual ?? 0,
    source: release.source,
    updatedAt: release.date
  }));
  const allowedKeys = new Set(filterObservationsByDate(observations, filters).map((item) => `${item.seriesId}:${item.date}`));
  return releases.filter((release) => allowedKeys.has(`${release.seriesId}:${release.date}`));
}

function db() {
  if (!prisma) throw new Error("DATABASE_URL is not configured");
  return prisma as never as {
    country: {
      findMany(args?: unknown): Promise<Record<string, unknown>[]>;
      upsert(args: unknown): Promise<unknown>;
      deleteMany(args: unknown): Promise<unknown>;
    };
    indicator: {
      findMany(args?: unknown): Promise<Record<string, unknown>[]>;
      upsert(args: unknown): Promise<unknown>;
    };
    series: {
      findMany(args?: unknown): Promise<Record<string, unknown>[]>;
      upsert(args: unknown): Promise<unknown>;
      deleteMany(args: unknown): Promise<unknown>;
    };
    observation: {
      findMany(args?: unknown): Promise<Record<string, unknown>[]>;
    };
    releaseEvent: {
      findMany(args?: unknown): Promise<Record<string, unknown>[]>;
    };
    dataProvider: {
      findMany(args?: unknown): Promise<Record<string, unknown>[]>;
      upsert(args: unknown): Promise<unknown>;
    };
  };
}
