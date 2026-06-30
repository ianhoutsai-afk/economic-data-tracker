import { describe, expect, it } from "vitest";
import { filterObservationsByDate } from "../src/services/dateRange.js";
import type { Observation } from "../src/types.js";

describe("date range filtering", () => {
  it("keeps the full starting quarter for quarterly range filters", () => {
    const observations: Observation[] = [
      observation("2021-01-01", "2021-Q1"),
      observation("2021-04-01", "2021-Q2"),
      observation("2026-03-31", "2026-Q1")
    ];

    expect(filterObservationsByDate(observations, { range: "5y" }).map((item) => item.period)).toEqual(["2021-Q1", "2021-Q2", "2026-Q1"]);
  });
});

function observation(date: string, period: string): Observation {
  return {
    seriesId: "US-gdp_real",
    date,
    period,
    frequency: "quarterly",
    value: 1,
    source: "test",
    updatedAt: date
  };
}
