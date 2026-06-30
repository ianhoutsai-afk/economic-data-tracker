import "./env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStaticSnapshot, isStaticDashboardSnapshot, type StaticSnapshotMode } from "./services/staticSnapshotService.js";
import type { StaticDashboardSnapshot } from "./types.js";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(backendRoot, "..");
const options = parseArguments(process.argv.slice(2));
const outputPath = resolve(workspaceRoot, options.output);
const previous = readPreviousSnapshot(outputPath);

const result = await buildStaticSnapshot({
  mode: options.mode,
  previous,
  historyYears: options.historyYears,
  now: options.now
});

if (result.attemptedSeries === 0 && previous) {
  console.log(JSON.stringify({ status: "skipped", reason: "no_series_due", output: outputPath }, null, 2));
  process.exit(0);
}

if (result.snapshot.observations.length === 0) {
  throw new Error("Static snapshot contains no observations; the previous Pages deployment was not replaced.");
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result.snapshot, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      status: result.failedSeries.length > 0 ? "completed_with_errors" : "ok",
      mode: options.mode,
      attemptedSeries: result.attemptedSeries,
      updatedSeries: result.updatedSeries,
      failedSeries: result.failedSeries,
      observations: result.snapshot.observations.length,
      generatedAt: result.snapshot.generatedAt,
      output: outputPath
    },
    null,
    2
  )
);

function readPreviousSnapshot(path: string): StaticDashboardSnapshot | undefined {
  if (!existsSync(path)) return undefined;
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isStaticDashboardSnapshot(value)) throw new Error(`Invalid existing static snapshot: ${path}`);
  return value;
}

function parseArguments(args: string[]) {
  const mode = argumentValue(args, "--mode") ?? "due";
  if (mode !== "due" && mode !== "full") throw new Error(`Unsupported snapshot mode: ${mode}`);

  const historyYears = Number(argumentValue(args, "--history-years") ?? 10);
  if (!Number.isInteger(historyYears) || historyYears < 1 || historyYears > 50) {
    throw new Error("--history-years must be an integer between 1 and 50");
  }

  const rawNow = argumentValue(args, "--now");
  const now = rawNow ? new Date(rawNow) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error(`Invalid --now timestamp: ${rawNow}`);

  return {
    mode: mode as StaticSnapshotMode,
    historyYears,
    now,
    output: argumentValue(args, "--output") ?? "frontend/public/data/dashboard.json"
  };
}

function argumentValue(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
