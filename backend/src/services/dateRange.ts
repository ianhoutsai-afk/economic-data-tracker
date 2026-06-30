import type { Observation, ObservationRange } from "../types.js";

type ObservationFilters = {
  from?: string;
  to?: string;
  range?: ObservationRange;
};

export function filterObservationsByDate(observations: Observation[], filters: ObservationFilters) {
  const sorted = observations.slice().sort((a, b) => a.date.localeCompare(b.date));
  const latestDate = sorted.at(-1)?.date;
  const from = filters.range && filters.range !== "all" ? rangeStart(latestDate, filters.range, sorted) : filters.from;
  const to = filters.to;

  return sorted.filter((item) => {
    if (from && item.date < from) return false;
    if (to && item.date > to) return false;
    return true;
  });
}

function rangeStart(latestDate: string | undefined, range: Exclude<ObservationRange, "all">, observations: Observation[]) {
  if (!latestDate) return undefined;

  const date = new Date(`${latestDate.slice(0, 10)}T00:00:00.000Z`);
  const years = range === "1y" ? 1 : range === "5y" ? 5 : 10;
  date.setUTCFullYear(date.getUTCFullYear() - years);

  if (observations.some((item) => item.frequency === "quarterly" || item.period?.includes("-Q"))) {
    const month = date.getUTCMonth();
    date.setUTCMonth(month - (month % 3), 1);
  } else if (observations.some((item) => item.frequency === "monthly" || /^\d{4}-\d{2}$/.test(item.period ?? ""))) {
    date.setUTCDate(1);
  }

  return date.toISOString().slice(0, 10);
}
