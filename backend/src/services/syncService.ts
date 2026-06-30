import { prisma } from "../db/prisma.js";
import type { ProviderObservation, ProviderReleaseEvent, Series } from "../types.js";
import { economicDataService } from "./economicDataService.js";
import { type FetchOptions, fetchSeriesData, isNeedsApiKeyError, isProviderConfigured } from "./providers.js";
import { nextReleaseDate } from "./releaseSchedule.js";

export type SyncResult = {
  seriesId: string;
  status: "success" | "failed" | "skipped";
  recordsUpserted: number;
  errorMessage?: string;
};

export async function syncDueSeries(now = new Date()): Promise<SyncResult[]> {
  if (!prisma) throw new Error("DATABASE_URL is required for sync");

  await economicDataService.ensureCatalog();
  const rows = await (prisma as never as Db).series.findMany({
    where: {
      status: "real",
      OR: [{ lastSyncedAt: null }, { nextReleaseDate: null }, { nextReleaseDate: { lte: now } }]
    },
    orderBy: [{ countryCode: "asc" }, { indicatorKey: "asc" }]
  });

  const results: SyncResult[] = [];
  for (const row of rows) {
    results.push(await syncSeries(row, now, { mode: "incremental", now }));
  }

  return results;
}

export async function syncHistoricalSeries(now = new Date(), lookbackYears = 10): Promise<SyncResult[]> {
  if (!prisma) throw new Error("DATABASE_URL is required for sync");

  await economicDataService.ensureCatalog();
  const rows = await (prisma as never as Db).series.findMany({
    where: {
      status: "real",
      indicatorKey: { in: ["gdp_real", "gdp_nominal", "cpi", "inflation_rate", "policy_rate"] }
    },
    orderBy: [{ countryCode: "asc" }, { indicatorKey: "asc" }]
  });

  const results: SyncResult[] = [];
  for (const row of rows) {
    results.push(await syncSeries(row, now, { mode: "history", lookbackYears, now }));
  }

  return results;
}

export async function syncSeries(series: Series, now = new Date(), options: FetchOptions = {}): Promise<SyncResult> {
  if (!prisma) throw new Error("DATABASE_URL is required for sync");

  const client = prisma as never as Db;
  if (series.sourceStatus === "needs_api_key" && !isProviderConfigured(series)) {
    return { seriesId: series.id, status: "skipped", recordsUpserted: 0, errorMessage: "API key is required" };
  }

  const run = await client.syncRun.create({
    data: {
      seriesId: series.id,
      source: series.source,
      status: "success",
      startedAt: now
    }
  });

  try {
    const payload = await fetchSeriesData(series, { ...options, now });
    logComparisonWarnings(series.id, payload.comparisonWarnings ?? []);
    let recordsUpserted = 0;

    for (const point of payload.observations) {
      await upsertObservation(client, series.id, point);
      recordsUpserted += 1;
    }

    for (const release of payload.releases) {
      await upsertReleaseEvent(client, series, release);
    }

    await client.series.update({
      where: { id: series.id },
      data: {
        lastSyncedAt: now,
        nextReleaseDate: nextReleaseDate(series, now),
        sourceStatus: payload.sourceStatus
      }
    });
    await client.syncRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        recordsUpserted
      }
    });

    return { seriesId: series.id, status: "success", recordsUpserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    const sourceStatus = isNeedsApiKeyError(error) ? "needs_api_key" : "failed";
    await client.series.update({
      where: { id: series.id },
      data: {
        sourceStatus,
        nextReleaseDate: retryDate(now)
      }
    });
    await client.syncRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: message
      }
    });
    return { seriesId: series.id, status: "failed", recordsUpserted: 0, errorMessage: message };
  }
}

function logComparisonWarnings(seriesId: string, warnings: Array<{ period: string; primarySource: string; comparisonSource: string; difference: number }>) {
  if (warnings.length === 0) return;

  const summary = warnings
    .slice(0, 5)
    .map((item) => `${item.period}: ${item.primarySource} vs ${item.comparisonSource} diff=${item.difference}`)
    .join("; ");
  console.warn(`Source comparison warnings for ${seriesId}: ${summary}`);
}

function retryDate(from: Date) {
  const date = new Date(from);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

async function upsertObservation(client: Db, seriesId: string, point: ProviderObservation) {
  const date = toUtcDate(point.date);
  const data = {
    date,
    period: point.period,
    frequency: point.frequency ?? "annual",
    value: point.value,
    rawValue: point.rawValue,
    normalizedValue: point.normalizedValue,
    revisionTag: point.revisionTag,
    source: point.source
  };

  if (point.period) {
    const existing = await client.observation.findFirst({
      where: {
        seriesId,
        period: point.period
      }
    });

    if (existing) {
      await client.observation.update({
        where: { id: existing.id },
        data
      });
      return;
    }
  }

  await client.observation.upsert({
    where: {
      seriesId_date: {
        seriesId,
        date
      }
    },
    update: {
      period: point.period,
      frequency: point.frequency,
      value: point.value,
      rawValue: point.rawValue,
      normalizedValue: point.normalizedValue,
      revisionTag: point.revisionTag,
      source: point.source
    },
    create: {
      seriesId,
      ...data
    }
  });
}

async function upsertReleaseEvent(client: Db, series: Series, release: ProviderReleaseEvent) {
  const date = toUtcDate(release.date);
  const data = {
    date,
    period: release.period ?? "",
    actual: release.actual,
    previous: release.previous,
    forecast: release.forecast,
    consensus: release.consensus,
    source: release.source,
    sourceUrl: release.sourceUrl
  };

  if (release.period) {
    const existing = await client.releaseEvent.findFirst({
      where: {
        seriesId: series.id,
        eventType: release.eventType,
        period: release.period
      }
    });

    if (existing) {
      await client.releaseEvent.update({
        where: { id: existing.id },
        data
      });
      return;
    }
  }

  await client.releaseEvent.upsert({
    where: {
      seriesId_eventType_date_period: {
        seriesId: series.id,
        eventType: release.eventType,
        date,
        period: release.period ?? ""
      }
    },
    update: {
      actual: release.actual,
      previous: release.previous,
      forecast: release.forecast,
      consensus: release.consensus,
      source: release.source,
      sourceUrl: release.sourceUrl
    },
    create: {
      seriesId: series.id,
      countryCode: series.countryCode,
      indicatorKey: series.indicatorKey,
      eventType: release.eventType,
      ...data
    }
  });
}

function toUtcDate(value: string) {
  const date = value.includes("T") ? value.slice(0, 10) : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid observation date: ${value}`);

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day));
}

type Db = {
  series: {
    findMany(args: unknown): Promise<Series[]>;
    update(args: unknown): Promise<unknown>;
  };
  observation: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    update(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
  releaseEvent: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    update(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
  syncRun: {
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
};
