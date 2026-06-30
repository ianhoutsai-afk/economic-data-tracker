import { afterEach, describe, expect, it, vi } from "vitest";
import { releaseCalendar } from "../src/data/releaseCalendar.js";
import { nextReleaseDate } from "../src/services/releaseSchedule.js";
import type { Series } from "../src/types.js";

describe("release schedule", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.keys(releaseCalendar).forEach((key) => delete releaseCalendar[key]);
  });

  it("uses country and indicator release rules", () => {
    const from = new Date("2026-05-20T00:00:00.000Z");

    expect(nextReleaseDate(series("US", "cpi"), from).toISOString()).toBe("2026-06-15T08:00:00.000Z");
    expect(nextReleaseDate(series("KR", "cpi"), from).toISOString()).toBe("2026-06-05T08:00:00.000Z");
    expect(nextReleaseDate(series("JP", "gdp_real"), from).toISOString()).toBe("2026-08-15T08:00:00.000Z");
  });

  it("allows scoped date overrides before falling back to rules", () => {
    vi.stubEnv("US_CPI_RELEASE_DATES", "2026-05-25,2026-06-12");

    expect(nextReleaseDate(series("US", "cpi"), new Date("2026-05-20T00:00:00.000Z")).toISOString()).toBe("2026-05-25T08:00:00.000Z");
  });

  it("uses the versioned calendar after environment overrides and before recurring rules", () => {
    releaseCalendar["US-cpi"] = ["2026-06-09T12:30:00.000Z"];

    expect(nextReleaseDate(series("US", "cpi"), new Date("2026-05-20T00:00:00.000Z")).toISOString()).toBe("2026-06-09T12:30:00.000Z");

    vi.stubEnv("US_CPI_RELEASE_DATES", "2026-06-11T12:30:00.000Z");
    expect(nextReleaseDate(series("US", "cpi"), new Date("2026-05-20T00:00:00.000Z")).toISOString()).toBe("2026-06-11T12:30:00.000Z");
  });

  it("checks China LPR on the twentieth of each month", () => {
    expect(nextReleaseDate(series("CN", "lpr"), new Date("2026-05-20T09:00:00.000Z")).toISOString()).toBe("2026-06-20T08:00:00.000Z");
  });
});

function series(countryCode: string, indicatorKey: Series["indicatorKey"]): Series {
  return {
    id: `${countryCode}-${indicatorKey}`,
    countryCode,
    indicatorKey,
    source: "test",
    status: "real"
  };
}
