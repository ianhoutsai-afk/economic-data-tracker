import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Series } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  fetchSeriesData: vi.fn(),
  prisma: {
    country: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn()
    },
    indicator: {
      upsert: vi.fn()
    },
    dataProvider: {
      upsert: vi.fn()
    },
    observation: {
      findFirst: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn()
    },
    releaseEvent: {
      findFirst: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn()
    },
    series: {
      update: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn()
    },
    syncRun: {
      create: vi.fn(),
      update: vi.fn()
    }
  }
}));

vi.mock("../src/db/prisma.js", () => ({
  prisma: mocks.prisma,
  hasDatabase: () => true
}));

vi.mock("../src/services/providers.js", () => ({
  fetchSeriesData: mocks.fetchSeriesData,
  isProviderConfigured: () => true,
  isNeedsApiKeyError: (error: unknown) => error instanceof Error && error.name === "NeedsApiKeyError"
}));

const { syncHistoricalSeries, syncSeries } = await import("../src/services/syncService.js");

describe("sync service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncRunCreateReturns("run-1");
  });

  it("upserts observations by series and date", async () => {
    mocks.fetchSeriesData.mockResolvedValue({
      observations: [
        { date: "2024-12-31", period: "2024-Q4", frequency: "quarterly", value: 102.4, source: "FRED" },
        { date: "2025-12-31", period: "2025-Q4", frequency: "quarterly", value: 103.1, source: "FRED" }
      ],
      releases: [{ eventType: "gdp_release", date: "2025-12-31", period: "2025-Q4", actual: 103.1, source: "FRED" }],
      sourceStatus: "fresh"
    });

    const result = await syncSeries(testSeries);

    expect(result).toMatchObject({ seriesId: "US-gdp_real", status: "success", recordsUpserted: 2 });
    expect(mocks.prisma.observation.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.releaseEvent.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.observation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          seriesId_date: {
            seriesId: "US-gdp_real",
            date: new Date("2024-12-31T00:00:00.000Z")
          }
        }
      })
    );
  });

  it("updates existing observations and releases by period when revised data moves dates", async () => {
    mocks.prisma.observation.findFirst.mockResolvedValueOnce({ id: "obs-1" });
    mocks.prisma.releaseEvent.findFirst.mockResolvedValueOnce({ id: "release-1" });
    mocks.fetchSeriesData.mockResolvedValue({
      observations: [{ date: "2025-01-30T00:00:00Z", period: "2024-Q4", frequency: "quarterly", value: 104.2, revisionTag: "second", source: "FRED" }],
      releases: [{ eventType: "gdp_release", date: "2025-01-30T00:00:00Z", period: "2024-Q4", actual: 104.2, source: "FRED" }],
      sourceStatus: "fresh"
    });

    const result = await syncSeries(testSeries);

    expect(result).toMatchObject({ status: "success", recordsUpserted: 1 });
    expect(mocks.prisma.observation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "obs-1" },
        data: expect.objectContaining({
          date: new Date("2025-01-30T00:00:00.000Z"),
          period: "2024-Q4",
          value: 104.2,
          revisionTag: "second"
        })
      })
    );
    expect(mocks.prisma.releaseEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "release-1" },
        data: expect.objectContaining({
          date: new Date("2025-01-30T00:00:00.000Z"),
          period: "2024-Q4",
          actual: 104.2
        })
      })
    );
    expect(mocks.prisma.observation.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.releaseEvent.upsert).not.toHaveBeenCalled();
  });

  it("records failed sync runs without deleting existing observations", async () => {
    mocks.fetchSeriesData.mockRejectedValue(new Error("source timeout"));

    const result = await syncSeries(testSeries);

    expect(result).toMatchObject({ seriesId: "US-gdp_real", status: "failed", recordsUpserted: 0 });
    expect(mocks.prisma.observation.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.releaseEvent.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.syncRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({
          status: "failed",
          errorMessage: "source timeout"
        })
      })
    );
  });

  it("runs historical sync for GDP, CPI, and policy rates with history mode", async () => {
    mocks.prisma.series.findMany.mockResolvedValue([testSeries]);
    mocks.fetchSeriesData.mockResolvedValue({
      observations: [],
      releases: [],
      sourceStatus: "fresh"
    });

    const now = new Date("2026-05-26T08:00:00.000Z");
    const result = await syncHistoricalSeries(now, 10);

    expect(result).toHaveLength(1);
    expect(mocks.prisma.series.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "real",
          indicatorKey: { in: ["gdp_real", "gdp_nominal", "cpi", "inflation_rate", "policy_rate"] }
        }
      })
    );
    expect(mocks.fetchSeriesData).toHaveBeenCalledWith(
      testSeries,
      expect.objectContaining({
        mode: "history",
        lookbackYears: 10,
        now
      })
    );
    expect(mocks.prisma.series.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["CN-policy_rate"] } } });
  });
});

function syncRunCreateReturns(id: string) {
  mocks.prisma.syncRun.create.mockResolvedValue({ id });
  mocks.prisma.syncRun.update.mockResolvedValue({});
  mocks.prisma.country.upsert.mockResolvedValue({});
  mocks.prisma.country.findMany.mockResolvedValue([]);
  mocks.prisma.country.deleteMany.mockResolvedValue({});
  mocks.prisma.indicator.upsert.mockResolvedValue({});
  mocks.prisma.dataProvider.upsert.mockResolvedValue({});
  mocks.prisma.series.update.mockResolvedValue({});
  mocks.prisma.series.upsert.mockResolvedValue({});
  mocks.prisma.series.deleteMany.mockResolvedValue({});
  mocks.prisma.observation.findFirst.mockResolvedValue(null);
  mocks.prisma.observation.update.mockResolvedValue({});
  mocks.prisma.observation.upsert.mockResolvedValue({});
  mocks.prisma.releaseEvent.findFirst.mockResolvedValue(null);
  mocks.prisma.releaseEvent.update.mockResolvedValue({});
  mocks.prisma.releaseEvent.upsert.mockResolvedValue({});
}

const testSeries: Series = {
  id: "US-gdp_real",
  countryCode: "US",
  indicatorKey: "gdp_real",
  source: "FRED",
  status: "real"
};
