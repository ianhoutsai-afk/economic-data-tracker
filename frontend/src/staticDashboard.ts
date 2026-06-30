import type {
  Country,
  DashboardPayload,
  Indicator,
  Observation,
  ObservationRange,
  ReleaseEvent,
  StaticDashboardSnapshot,
  ViewFrequency
} from "./types";

export type StaticDashboardFilters = {
  range?: ObservationRange;
  indicatorKey?: Indicator["key"];
  countryCode?: string;
  region?: Country["region"] | "all";
  viewFrequency?: ViewFrequency;
};

export function filterStaticDashboard(
  snapshot: StaticDashboardSnapshot,
  filters: StaticDashboardFilters = {}
): StaticDashboardSnapshot {
  const countryCodes = new Set(
    snapshot.countries
      .filter((country) => !filters.region || filters.region === "all" || country.region === filters.region)
      .map((country) => country.code)
  );
  const series = snapshot.series.filter(
    (item) =>
      countryCodes.has(item.countryCode) &&
      (!filters.countryCode || item.countryCode === filters.countryCode) &&
      (!filters.indicatorKey || item.indicatorKey === filters.indicatorKey)
  );
  const seriesIds = new Set(series.map((item) => item.id));
  const observations = applyViewFrequency(
    filterByRange(snapshot.observations.filter((item) => seriesIds.has(item.seriesId)), filters.range),
    filters.viewFrequency
  );
  const releases = filterReleasesByRange(
    snapshot.releases.filter((item) => seriesIds.has(item.seriesId)),
    filters.range
  );

  return {
    ...snapshot,
    series,
    observations,
    releases,
    dataQualityWarnings: snapshot.dataQualityWarnings.filter((item) => seriesIds.has(item.seriesId))
  };
}

export function asStaticDashboardSnapshot(value: unknown): StaticDashboardSnapshot {
  if (!isStaticDashboardSnapshot(value)) throw new Error("Invalid static dashboard snapshot");
  return value;
}

function isStaticDashboardSnapshot(value: unknown): value is StaticDashboardSnapshot {
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

function filterByRange(observations: Observation[], range: ObservationRange | undefined) {
  const sorted = observations.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!range || range === "all") return sorted;

  const latest = sorted.at(-1)?.date;
  if (!latest) return sorted;

  const start = new Date(`${latest.slice(0, 10)}T00:00:00.000Z`);
  start.setUTCFullYear(start.getUTCFullYear() - (range === "1y" ? 1 : range === "5y" ? 5 : 10));

  if (sorted.some((item) => item.frequency === "quarterly" || item.period?.includes("-Q"))) {
    const month = start.getUTCMonth();
    start.setUTCMonth(month - (month % 3), 1);
  } else if (sorted.some((item) => item.frequency === "monthly" || /^\d{4}-\d{2}$/.test(item.period ?? ""))) {
    start.setUTCDate(1);
  }

  const startKey = start.toISOString().slice(0, 10);
  return sorted.filter((item) => item.date >= startKey);
}

function filterReleasesByRange(releases: ReleaseEvent[], range: ObservationRange | undefined) {
  if (!range || range === "all") return releases.slice().sort((a, b) => a.date.localeCompare(b.date));
  const proxyObservations: Observation[] = releases.map((item) => ({
    seriesId: item.seriesId,
    date: item.date,
    value: item.actual ?? 0,
    source: item.source,
    updatedAt: item.date
  }));
  const allowed = new Set(filterByRange(proxyObservations, range).map((item) => `${item.seriesId}:${item.date}`));
  return releases.filter((item) => allowed.has(`${item.seriesId}:${item.date}`));
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

export function dashboardPayload(snapshot: StaticDashboardSnapshot): DashboardPayload {
  return snapshot;
}
