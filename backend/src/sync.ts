import "./env.js";
import { prisma } from "./db/prisma.js";
import { syncDueSeries } from "./services/syncService.js";

try {
  const results = await syncDueSeries();
  const failed = results.filter((item) => item.status === "failed");
  const totalRecords = results.reduce((sum, item) => sum + item.recordsUpserted, 0);

  console.log(
    JSON.stringify(
      {
        status: failed.length > 0 ? "completed_with_errors" : "ok",
        seriesChecked: results.length,
        recordsUpserted: totalRecords,
        failed: failed.map((item) => ({ seriesId: item.seriesId, errorMessage: item.errorMessage }))
      },
      null,
      2
    )
  );

  await prisma?.$disconnect();
  if (failed.length === results.length && results.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await prisma?.$disconnect();
  process.exitCode = 1;
}
