import { describe, expect, it, vi } from "vitest";
import { buildStaticSnapshot, isStaticDashboardSnapshot, sanitizeProviderError } from "../src/services/staticSnapshotService.js";

describe("static snapshot service", () => {
  it("builds a valid full snapshot and merges revisions by period", async () => {
    const first = await buildStaticSnapshot({
      mode: "full",
      now: new Date("2026-05-01T00:00:00.000Z"),
      fetcher: successfulFetcher("2026-03-31", 100)
    });

    expect(isStaticDashboardSnapshot(first.snapshot)).toBe(true);
    expect(first.snapshot.observations.length).toBeGreaterThan(0);

    makeOnlySeriesDue(first.snapshot, "EU-cpi", "2026-05-02T00:00:00.000Z");
    const revised = await buildStaticSnapshot({
      mode: "due",
      now: new Date("2026-05-02T01:00:00.000Z"),
      previous: first.snapshot,
      fetcher: successfulFetcher("2026-04-30", 101)
    });

    const observations = revised.snapshot.observations.filter((item) => item.seriesId === "EU-cpi");
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ date: "2026-04-30", period: "2026-Q1", value: 101 });
    expect(revised.snapshot.syncState["EU-cpi"]).toMatchObject({ retryCount: 0 });
  });

  it("preserves the last successful series data and retries failures daily", async () => {
    const initial = await buildStaticSnapshot({
      mode: "full",
      now: new Date("2026-05-01T00:00:00.000Z"),
      fetcher: successfulFetcher("2026-03-31", 100)
    });
    const original = initial.snapshot.observations.find((item) => item.seriesId === "EU-cpi");
    expect(original).toBeDefined();

    let previous = initial.snapshot;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const now = new Date(`2026-05-0${attempt + 1}T01:00:00.000Z`);
      makeOnlySeriesDue(previous, "EU-cpi", now.toISOString());
      const failed = await buildStaticSnapshot({
        mode: "due",
        now,
        previous,
        fetcher: vi.fn().mockRejectedValue(new Error("source timeout"))
      });

      expect(failed.snapshot.observations.find((item) => item.seriesId === "EU-cpi")).toEqual(original);
      expect(failed.snapshot.series.find((item) => item.id === "EU-cpi")?.sourceStatus).toBe("stale");
      expect(failed.snapshot.syncState["EU-cpi"].retryCount).toBe(attempt);
      previous = failed.snapshot;
    }

    expect(previous.syncState["EU-cpi"].nextReleaseDate).not.toBe("2026-05-05T01:00:00.000Z");
  });

  it("skips a due run when every series is scheduled in the future", async () => {
    const initial = await buildStaticSnapshot({
      mode: "full",
      now: new Date("2026-05-01T00:00:00.000Z"),
      fetcher: successfulFetcher("2026-03-31", 100)
    });
    Object.values(initial.snapshot.syncState).forEach((state) => {
      state.nextReleaseDate = "2099-01-01T00:00:00.000Z";
    });

    const fetcher = vi.fn();
    const result = await buildStaticSnapshot({
      mode: "due",
      now: new Date("2026-05-02T00:00:00.000Z"),
      previous: initial.snapshot,
      fetcher
    });

    expect(result.attemptedSeries).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.snapshot).toBe(initial.snapshot);
  });

  it("redacts API credentials from public snapshot errors", () => {
    vi.stubEnv("FRED_API_KEY", "private-test-key");
    expect(sanitizeProviderError(new Error("request failed: ?api_key=private-test-key"))).toBe(
      "request failed: ?api_key=[redacted]"
    );
    vi.unstubAllEnvs();
  });
});

function successfulFetcher(date: string, value: number) {
  return vi.fn(async (series: { id: string }) => ({
    observations: [
      {
        date,
        period: "2026-Q1",
        frequency: "quarterly" as const,
        value,
        source: `Test ${series.id}`
      }
    ],
    releases: [],
    sourceStatus: "fresh" as const,
    comparisonWarnings: []
  }));
}

function makeOnlySeriesDue(
  snapshot: Awaited<ReturnType<typeof buildStaticSnapshot>>["snapshot"],
  seriesId: string,
  dueAt: string
) {
  Object.entries(snapshot.syncState).forEach(([id, state]) => {
    state.nextReleaseDate = id === seriesId ? dueAt : "2099-01-01T00:00:00.000Z";
  });
}
