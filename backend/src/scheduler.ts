import { syncDueSeries, syncHistoricalSeries } from "./services/syncService.js";

const defaultSchedulerIntervalMinutes = 60;
let isRunning = false;
let lastHistoricalSyncWeek: string | undefined;

export function startScheduler() {
  if (process.env.ENABLE_SCHEDULER !== "true") return;

  void runOnce();
  scheduleNextRun();
}

async function runOnce() {
  if (isRunning) return;
  isRunning = true;

  try {
    const results = await syncDueSeries();
    const records = results.reduce((sum, item) => sum + item.recordsUpserted, 0);
    console.log(`Economic data sync checked ${results.length} series and upserted ${records} observations`);

    if (shouldRunHistoricalSync()) {
      const historyResults = await syncHistoricalSeries();
      const historyRecords = historyResults.reduce((sum, item) => sum + item.recordsUpserted, 0);
      lastHistoricalSyncWeek = utcWeekKey(new Date());
      console.log(`Historical data sync checked ${historyResults.length} series and upserted ${historyRecords} observations`);
    }
  } catch (error) {
    console.error("Economic data sync failed", error);
  } finally {
    isRunning = false;
  }
}

function scheduleNextRun() {
  const intervalMinutes = schedulerIntervalMinutes();
  const now = new Date();
  const intervalMs = intervalMinutes * 60 * 1000;
  const nextRunAt = Math.floor(now.getTime() / intervalMs) * intervalMs + intervalMs;

  setTimeout(() => {
    void runOnce().finally(scheduleNextRun);
  }, nextRunAt - now.getTime());
}

function schedulerIntervalMinutes() {
  const value = Number(process.env.SCHEDULER_INTERVAL_MINUTES ?? defaultSchedulerIntervalMinutes);
  if (!Number.isInteger(value) || value < 1 || value > 1440) return defaultSchedulerIntervalMinutes;
  return value;
}

function shouldRunHistoricalSync(now = new Date()) {
  const day = Number(process.env.HISTORY_SYNC_DAY_UTC ?? 6);
  const hour = Number(process.env.HISTORY_SYNC_HOUR_UTC ?? 9);
  if (now.getUTCDay() !== day || now.getUTCHours() !== hour) return false;

  const week = utcWeekKey(now);
  return lastHistoricalSyncWeek !== week;
}

function utcWeekKey(date: Date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const day = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return `${date.getUTCFullYear()}-${Math.floor(day / 7)}`;
}
