ALTER TABLE "Series" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "Series" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'real';
ALTER TABLE "Series" ADD COLUMN "sourceStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Series" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "Series" ADD COLUMN "nextReleaseDate" TIMESTAMP(3);

CREATE INDEX "Series_nextReleaseDate_idx" ON "Series"("nextReleaseDate");

CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "recordsUpserted" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SyncRun_seriesId_idx" ON "SyncRun"("seriesId");
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
