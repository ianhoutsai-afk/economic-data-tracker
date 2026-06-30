CREATE TABLE "Country" (
    "code" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "region" TEXT NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "Indicator" (
    "key" TEXT NOT NULL,
    "nameZh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,

    CONSTRAINT "Indicator_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "Series" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "indicatorKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Series_countryCode_indicatorKey_source_key" ON "Series"("countryCode", "indicatorKey", "source");
CREATE INDEX "Series_countryCode_idx" ON "Series"("countryCode");
CREATE INDEX "Series_indicatorKey_idx" ON "Series"("indicatorKey");
CREATE UNIQUE INDEX "Observation_seriesId_date_key" ON "Observation"("seriesId", "date");
CREATE INDEX "Observation_date_idx" ON "Observation"("date");

ALTER TABLE "Series" ADD CONSTRAINT "Series_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "Country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Series" ADD CONSTRAINT "Series_indicatorKey_fkey" FOREIGN KEY ("indicatorKey") REFERENCES "Indicator"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
