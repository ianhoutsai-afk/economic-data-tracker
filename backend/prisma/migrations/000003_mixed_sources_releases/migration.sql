ALTER TABLE "Series" ADD COLUMN "providerKey" TEXT;

ALTER TABLE "Observation" ADD COLUMN "period" TEXT;
ALTER TABLE "Observation" ADD COLUMN "frequency" TEXT NOT NULL DEFAULT 'annual';
ALTER TABLE "Observation" ADD COLUMN "rawValue" DOUBLE PRECISION;
ALTER TABLE "Observation" ADD COLUMN "normalizedValue" DOUBLE PRECISION;
ALTER TABLE "Observation" ADD COLUMN "revisionTag" TEXT;

CREATE TABLE "ReleaseEvent" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "indicatorKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "period" TEXT,
    "actual" DOUBLE PRECISION,
    "previous" DOUBLE PRECISION,
    "forecast" DOUBLE PRECISION,
    "consensus" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataProvider" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "priority" INTEGER NOT NULL,
    "requiresApiKey" BOOLEAN NOT NULL DEFAULT false,
    "registrationUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "coverage" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataProvider_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "ReleaseEvent_seriesId_eventType_date_period_key" ON "ReleaseEvent"("seriesId", "eventType", "date", "period");
CREATE INDEX "ReleaseEvent_countryCode_idx" ON "ReleaseEvent"("countryCode");
CREATE INDEX "ReleaseEvent_indicatorKey_idx" ON "ReleaseEvent"("indicatorKey");
CREATE INDEX "ReleaseEvent_date_idx" ON "ReleaseEvent"("date");

ALTER TABLE "ReleaseEvent" ADD CONSTRAINT "ReleaseEvent_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
