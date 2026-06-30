import { describe, expect, it } from "vitest";
import { asStaticDashboardSnapshot, filterStaticDashboard } from "../src/staticDashboard";
import type { StaticDashboardSnapshot } from "../src/types";

describe("static dashboard", () => {
  it("filters region, indicator, range, and quarterly view in the browser", () => {
    const result = filterStaticDashboard(snapshot, {
      region: "europe",
      indicatorKey: "cpi",
      range: "1y",
      viewFrequency: "quarterly"
    });

    expect(result.series.map((item) => item.id)).toEqual(["EU-cpi"]);
    expect(result.observations).toHaveLength(2);
    expect(result.observations.map((item) => item.date)).toEqual(["2025-06-30", "2026-03-31"]);
    expect(result.generatedAt).toBe(snapshot.generatedAt);
  });

  it("rejects malformed snapshots", () => {
    expect(() => asStaticDashboardSnapshot({ observations: [] })).toThrow("Invalid static dashboard snapshot");
  });
});

const snapshot: StaticDashboardSnapshot = {
  snapshotVersion: 1,
  generatedAt: "2026-04-01T00:00:00.000Z",
  countries: [
    { code: "EU", nameZh: "歐元區", nameEn: "Euro Area", region: "europe" },
    { code: "US", nameZh: "美國", nameEn: "United States", region: "north_america" }
  ],
  indicators: [{ key: "cpi", nameZh: "CPI", nameEn: "CPI", unit: "%", frequency: "monthly" }],
  series: [
    { id: "EU-cpi", countryCode: "EU", indicatorKey: "cpi", source: "Eurostat" },
    { id: "US-cpi", countryCode: "US", indicatorKey: "cpi", source: "BLS" }
  ],
  observations: [
    observation("EU-cpi", "2024-03-01", 1),
    observation("EU-cpi", "2025-04-01", 2),
    observation("EU-cpi", "2025-06-01", 3),
    observation("EU-cpi", "2026-03-01", 4),
    observation("US-cpi", "2026-03-01", 5)
  ],
  releases: [],
  providers: [],
  dataQualityWarnings: [],
  syncState: {
    "EU-cpi": { retryCount: 0 },
    "US-cpi": { retryCount: 0 }
  }
};

function observation(seriesId: string, date: string, value: number) {
  return {
    seriesId,
    date,
    period: date.slice(0, 7),
    frequency: "monthly" as const,
    value,
    source: "test",
    updatedAt: "2026-04-01T00:00:00.000Z"
  };
}
