import type { IndicatorKey, Series } from "../types.js";
import { releaseCalendar } from "../data/releaseCalendar.js";

type MonthlyRule = {
  cadence: "monthly";
  dayOfMonth: number;
};

type QuarterlyRule = {
  cadence: "quarterly";
  months: number[];
  dayOfMonth: number;
};

type IntervalRule = {
  cadence: "interval";
  days: number;
};

type ReleaseRule = MonthlyRule | QuarterlyRule | IntervalRule;

const countryIndicatorRules: Record<string, Partial<Record<IndicatorKey, ReleaseRule>>> = {
  US: {
    gdp_real: { cadence: "quarterly", months: [0, 3, 6, 9], dayOfMonth: 30 },
    gdp_nominal: { cadence: "quarterly", months: [0, 3, 6, 9], dayOfMonth: 30 },
    cpi: { cadence: "monthly", dayOfMonth: 15 },
    inflation_rate: { cadence: "monthly", dayOfMonth: 15 },
    policy_rate: { cadence: "interval", days: 42 }
  },
  EU: {
    gdp_real: { cadence: "quarterly", months: [0, 3, 6, 9], dayOfMonth: 30 },
    gdp_nominal: { cadence: "quarterly", months: [0, 3, 6, 9], dayOfMonth: 30 },
    cpi: { cadence: "monthly", dayOfMonth: 17 },
    inflation_rate: { cadence: "monthly", dayOfMonth: 17 },
    policy_rate: { cadence: "interval", days: 42 }
  },
  JP: {
    gdp_real: { cadence: "quarterly", months: [1, 4, 7, 10], dayOfMonth: 15 },
    gdp_nominal: { cadence: "quarterly", months: [1, 4, 7, 10], dayOfMonth: 15 },
    cpi: { cadence: "monthly", dayOfMonth: 22 },
    inflation_rate: { cadence: "monthly", dayOfMonth: 22 },
    policy_rate: { cadence: "interval", days: 45 }
  },
  KR: {
    gdp_real: { cadence: "quarterly", months: [0, 3, 6, 9], dayOfMonth: 25 },
    gdp_nominal: { cadence: "quarterly", months: [0, 3, 6, 9], dayOfMonth: 25 },
    cpi: { cadence: "monthly", dayOfMonth: 5 },
    inflation_rate: { cadence: "monthly", dayOfMonth: 5 },
    policy_rate: { cadence: "interval", days: 42 }
  },
  CN: {
    gdp_real: { cadence: "quarterly", months: [0, 3, 6, 9], dayOfMonth: 18 },
    gdp_nominal: { cadence: "quarterly", months: [0, 3, 6, 9], dayOfMonth: 18 },
    cpi: { cadence: "monthly", dayOfMonth: 10 },
    inflation_rate: { cadence: "monthly", dayOfMonth: 10 },
    lpr: { cadence: "monthly", dayOfMonth: 20 }
  },
  TW: {
    gdp_real: { cadence: "quarterly", months: [1, 4, 7, 10], dayOfMonth: 20 },
    gdp_nominal: { cadence: "quarterly", months: [1, 4, 7, 10], dayOfMonth: 20 },
    cpi: { cadence: "monthly", dayOfMonth: 8 },
    inflation_rate: { cadence: "monthly", dayOfMonth: 8 },
    policy_rate: { cadence: "interval", days: 45 }
  }
};

export function nextReleaseDate(series: Series, from = new Date()) {
  const configured = configuredReleaseDates(series);
  const nextConfigured = configured.find((date) => date > from);
  if (nextConfigured) return nextConfigured;

  const rule = countryIndicatorRules[series.countryCode]?.[series.indicatorKey] ?? defaultRule(series.indicatorKey);
  if (rule.cadence === "monthly") return nextMonthlyCheck(from, rule.dayOfMonth);
  if (rule.cadence === "quarterly") return nextQuarterlyCheck(from, rule.months, rule.dayOfMonth);
  return nextIntervalCheck(from, rule.days);
}

function defaultRule(indicatorKey: IndicatorKey): ReleaseRule {
  if (indicatorKey === "gdp_real" || indicatorKey === "gdp_nominal") return { cadence: "quarterly", months: [0, 3, 6, 9], dayOfMonth: 30 };
  if (indicatorKey === "cpi" || indicatorKey === "inflation_rate") return { cadence: "monthly", dayOfMonth: 15 };
  return { cadence: "interval", days: 42 };
}

function nextMonthlyCheck(from: Date, dayOfMonth: number) {
  const candidate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), dayOfMonth, 8));
  if (candidate > from) return candidate;
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, dayOfMonth, 8));
}

function nextQuarterlyCheck(from: Date, months: number[], dayOfMonth: number) {
  for (const month of months) {
    const candidate = new Date(Date.UTC(from.getUTCFullYear(), month, dayOfMonth, 8));
    if (candidate > from) return candidate;
  }
  return new Date(Date.UTC(from.getUTCFullYear() + 1, months[0] ?? 0, dayOfMonth, 8));
}

function nextIntervalCheck(from: Date, days: number) {
  const candidate = new Date(from);
  candidate.setUTCDate(candidate.getUTCDate() + days);
  candidate.setUTCHours(8, 0, 0, 0);
  return candidate;
}

function configuredReleaseDates(series: Series) {
  const scopedKey = `${series.countryCode}_${series.indicatorKey}_RELEASE_DATES`.toUpperCase();
  const genericPolicyDates = series.indicatorKey === "policy_rate" ? process.env.POLICY_RATE_RELEASE_DATES : undefined;
  const environmentDates = parseConfiguredDates(
    [process.env[scopedKey], process.env.RELEASE_DATES, genericPolicyDates].filter(Boolean).join(",")
  );
  if (environmentDates.length > 0) return environmentDates;

  return parseConfiguredDates(releaseCalendar[series.id]?.join(","));
}

function parseConfiguredDates(value: string | undefined) {
  if (!value) return [];

  return value
    .split(",")
    .map((item) => parseReleaseDate(item.trim()))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
}

function parseReleaseDate(value: string) {
  return new Date(value.includes("T") ? value : `${value}T08:00:00.000Z`);
}
