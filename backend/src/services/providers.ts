import { bisPolicyCountryCodes, unitForSeries } from "../data/catalog.js";
import type { DataFrequency, IndicatorKey, ProviderObservation, ProviderReleaseEvent, Series, SourceStatus } from "../types.js";

export type ProviderPayload = {
  observations: ProviderObservation[];
  releases: ProviderReleaseEvent[];
  sourceStatus: SourceStatus;
  comparisonWarnings?: SourceComparisonWarning[];
};

export type FetchMode = "incremental" | "history";

export type FetchOptions = {
  mode?: FetchMode;
  lookbackYears?: number;
  now?: Date;
};

export type SourceComparisonWarning = {
  period: string;
  primarySource: string;
  comparisonSource: string;
  primaryValue: number;
  comparisonValue: number;
  difference: number;
};

type ProviderAdapter = {
  key: string;
  name: string;
  fetch(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload>;
};

type CacheEntry = {
  expiresAt: number;
  promise: Promise<ProviderPayload>;
};

const providerCache = new Map<string, CacheEntry>();
const defaultProviderCacheTtlMs = 15 * 60 * 1000;

class NeedsApiKeyError extends Error {
  constructor(provider: string) {
    super(`${provider} API key is required`);
    this.name = "NeedsApiKeyError";
  }
}

export function isNeedsApiKeyError(error: unknown) {
  return error instanceof NeedsApiKeyError;
}

export function isProviderConfigured(series: Series) {
  if (series.providerKey === "fred") return Boolean(process.env.FRED_API_KEY);
  if (series.providerKey === "estat") return Boolean(process.env.ESTAT_APP_ID);
  return true;
}

export async function fetchSeriesData(series: Series, options: FetchOptions = {}): Promise<ProviderPayload> {
  const normalizedOptions = normalizeFetchOptions(options);
  const cacheKey = providerCacheKey(series, normalizedOptions);
  const cached = providerCache.get(cacheKey);
  const nowMs = Date.now();

  if (cached && cached.expiresAt > nowMs) return cached.promise;

  const promise = fetchSeriesDataUncached(series, normalizedOptions).catch((error) => {
    providerCache.delete(cacheKey);
    throw error;
  });
  providerCache.set(cacheKey, {
    expiresAt: nowMs + providerCacheTtlMs(),
    promise
  });

  return promise;
}

export function clearProviderCache() {
  providerCache.clear();
}

async function fetchSeriesDataUncached(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  if (series.status === "unavailable") return emptyPayload("unavailable");
  if (series.sourceStatus === "needs_api_key" && !isProviderConfigured(series)) return emptyPayload("needs_api_key");

  const adapter = adapters.find((item) => item.key === series.providerKey) ?? (series.indicatorKey === "policy_rate" ? bisAdapter : undefined);
  if (!adapter) return emptyPayload("unavailable");

  const payload = await adapter.fetch(series, options);
  const authoritative = await preferOfficialSource(series, payload, options);

  return {
    ...authoritative.payload,
    comparisonWarnings: dedupeSourceComparisonWarnings([
      ...(payload.comparisonWarnings ?? []),
      ...authoritative.warnings
    ])
  };
}

function normalizeFetchOptions(options: FetchOptions): Required<FetchOptions> {
  return {
    mode: options.mode ?? "incremental",
    lookbackYears: options.lookbackYears ?? 10,
    now: options.now ?? new Date()
  };
}

function providerCacheKey(series: Series, options: Required<FetchOptions>) {
  return [series.id, series.providerKey ?? "unknown", options.mode, options.lookbackYears].join(":");
}

function providerCacheTtlMs() {
  const value = Number(process.env.PROVIDER_CACHE_TTL_SECONDS);
  if (!Number.isFinite(value) || value <= 0) return defaultProviderCacheTtlMs;
  return value * 1000;
}

const fredAdapter: ProviderAdapter = {
  key: "fred",
  name: "FRED",
  fetch: fetchFred
};

const dbnomicsAdapter: ProviderAdapter = {
  key: "dbnomics",
  name: "DBnomics",
  fetch: fetchDbnomics
};

const chinaNbsDbnomicsAdapter: ProviderAdapter = {
  key: "china_nbs_dbnomics",
  name: "China NBS composite",
  fetch: fetchChinaNbsComposite
};

const worldBankAdapter: ProviderAdapter = {
  key: "world_bank",
  name: "World Bank API",
  fetch: fetchWorldBank
};

const imfDataMapperAdapter: ProviderAdapter = {
  key: "imf_datamapper",
  name: "IMF DataMapper API",
  fetch: fetchImfDataMapper
};

const taiwanOpenDataAdapter: ProviderAdapter = {
  key: "taiwan_open_data",
  name: "Taiwan Government Open Data",
  fetch: fetchTaiwanOpenData
};

const blsAdapter: ProviderAdapter = {
  key: "bls",
  name: "BLS Public Data API",
  fetch: fetchBlsCpi
};

const eurostatAdapter: ProviderAdapter = {
  key: "eurostat",
  name: "Eurostat API",
  fetch: fetchEurostat
};

const ecbAdapter: ProviderAdapter = {
  key: "ecb",
  name: "ECB Data Portal",
  fetch: fetchEcbPolicy
};

const estatAdapter: ProviderAdapter = {
  key: "estat",
  name: "Japan e-Stat API",
  fetch: fetchEstat
};

const bisAdapter: ProviderAdapter = {
  key: "bis",
  name: "BIS WS_CBPOL",
  fetch: fetchBisPolicyRate
};

const adapters = [
  fredAdapter,
  dbnomicsAdapter,
  chinaNbsDbnomicsAdapter,
  imfDataMapperAdapter,
  taiwanOpenDataAdapter,
  blsAdapter,
  eurostatAdapter,
  ecbAdapter,
  estatAdapter,
  bisAdapter
];

async function fetchFred(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  const key = process.env.FRED_API_KEY;
  if (!key) throw new NeedsApiKeyError("FRED");

  const seriesId = fredSeriesId(series.indicatorKey);
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  if (options.mode === "history") url.searchParams.set("observation_start", providerHistoryStartDate(series, options));

  const response = await fetch(url);
  if (!response.ok) throw new Error(`FRED request failed with ${response.status}`);

  const payload = (await response.json()) as { observations?: Array<{ date?: string; value?: string }> };
  const rawObservations = (payload.observations ?? [])
    .map((row) =>
      toObservation(
        row.date,
        row.value,
        observationFrequency(series.indicatorKey),
        "FRED",
        series.indicatorKey
      )
    )
    .filter((item): item is ProviderObservation => Boolean(item));
  const observations = normalizeProviderObservations(rawObservations, series.indicatorKey, "cpi_index").filter(
    (item) => options.mode !== "history" || item.date >= historyStartDate(options)
  );

  return withReleases(observations, series, "fresh");
}

async function fetchDbnomics(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  const dbnomicsSeries = dbnomicsSeriesFor(series);
  if (!dbnomicsSeries) return emptyPayload("unavailable");

  return fetchDbnomicsMapping(series, options, dbnomicsSeries);
}

async function fetchDbnomicsMapping(
  series: Series,
  options: Required<FetchOptions>,
  dbnomicsSeries: DbnomicsSeriesMapping
): Promise<ProviderPayload> {
  const url = new URL(
    `https://api.db.nomics.world/v22/series/${dbnomicsSeries.providerCode}/${dbnomicsSeries.datasetCode}/${dbnomicsSeries.seriesCode}`
  );
  url.searchParams.set("observations", "1");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`DBnomics request failed with ${response.status}`);

  const rawObservations = parseDbnomicsObservations(await response.json(), series, dbnomicsSeries.source)
    .filter((item) => item.date >= providerHistoryStartDate(series, options))
    .sort((a, b) => a.date.localeCompare(b.date));
  const observations = normalizeDbnomicsObservations(
    normalizeProviderObservations(rawObservations, series.indicatorKey, dbnomicsSeries.valueFormat),
    series
  ).filter((item) => item.date >= historyStartDate(options));

  return withReleases(observations, series, observations.length > 0 ? "fresh" : "stale");
}

async function fetchChinaNbsComposite(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  if (series.countryCode !== "CN") return emptyPayload("unavailable");
  if (series.indicatorKey === "gdp_real") return emptyPayload("unavailable");
  if (series.indicatorKey === "gdp_nominal") return fetchChinaNominalGdp(series, options);
  if (series.indicatorKey === "cpi" || series.indicatorKey === "inflation_rate") return fetchChinaCpi(series, options);
  return emptyPayload("unavailable");
}

async function fetchChinaNominalGdp(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  const [direct, mirror] = await Promise.all([
    fetchOptionalChinaSource("China NBS direct GDP", () => fetchChinaNbsDirect(series, options)),
    fetchOptionalChinaSource("DBnomics China NBS GDP", () => fetchDbnomicsMapping(series, options, chinaNominalGdpMapping))
  ]);
  const observations = mergeObservationSources([direct.observations, mirror.observations]);
  const comparisonWarnings = compareObservations(direct.observations, mirror.observations, series.indicatorKey);

  return {
    ...withReleases(observations, series, observations.length > 0 ? "fresh" : "stale"),
    comparisonWarnings
  };
}

async function fetchChinaCpi(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  const activeMappings = chinaNbsCpiMappings.filter((mapping) => chinaCpiMappingOverlapsOptions(mapping, options));
  const [direct, mirrorPayloads, imf] = await Promise.all([
    fetchOptionalChinaSource("China NBS direct CPI", () => fetchChinaNbsDirect(series, options)),
    Promise.all(
      activeMappings.map((mapping) =>
        fetchOptionalChinaSource(`DBnomics China NBS CPI ${mapping.seriesCode}`, async () => {
          const payload = await fetchDbnomicsMapping(series, options, mapping);
          return {
            ...payload,
            observations: filterChinaCpiMappingRange(payload.observations, mapping)
          };
        })
      )
    ),
    fetchOptionalChinaSource("DBnomics IMF CPI fallback", () => fetchDbnomicsMapping(series, options, chinaImfCpiMapping))
  ]);
  const mirrorObservations = mergeObservationSources(mirrorPayloads.reverse().map((payload) => payload.observations));
  const nbsObservations = mergeObservationSources([direct.observations, mirrorObservations]);
  const observations = mergeObservationSources([nbsObservations, imf.observations]);
  const comparisonWarnings = dedupeSourceComparisonWarnings([
    ...compareObservations(direct.observations, mirrorObservations, series.indicatorKey),
    ...compareObservations(nbsObservations, imf.observations, series.indicatorKey)
  ]);

  return {
    ...withReleases(observations, series, nbsObservations.length > 0 ? "fresh" : "stale"),
    comparisonWarnings
  };
}

async function fetchOptionalChinaSource(label: string, fetchPayload: () => Promise<ProviderPayload>) {
  try {
    return await fetchPayload();
  } catch (error) {
    console.warn(`${label} skipped: ${error instanceof Error ? error.message : "unknown provider error"}`);
    return emptyPayload("stale");
  }
}

async function fetchChinaNbsDirect(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  if (!nbsDirectEnabled()) return emptyPayload("unavailable");

  if (series.indicatorKey === "gdp_nominal") {
    const observations = normalizeChinaNbsObservations(
      await fetchChinaNbsEasyQuery(series, "hgjd", "A010101", nbsYearPeriods(options)),
      series
    ).filter((item) => item.date >= historyStartDate(options));
    return withReleases(observations, series, observations.length > 0 ? "fresh" : "stale");
  }

  const observations = mergeObservationSources(
    (
      await Promise.all(
        chinaNbsCpiMappings
          .filter((mapping) => chinaCpiMappingOverlapsOptions(mapping, options))
          .map(async (mapping) => {
            const periods = nbsMonthlyPeriods(options).filter((period) => chinaCpiMappingIncludesYear(mapping, Number(period.slice(0, 4))));
            if (periods.length === 0) return [];
            return normalizeChinaNbsObservations(
              await fetchChinaNbsEasyQuery(series, "hgyd", mapping.seriesCode, periods),
              series
            );
          })
      )
    ).reverse()
  ).filter((item) => item.date >= historyStartDate(options));

  return withReleases(observations, series, observations.length > 0 ? "fresh" : "stale");
}

async function fetchChinaNbsEasyQuery(series: Series, dbcode: string, indicatorCode: string, periods: string[]) {
  if (periods.length === 0) return [];

  const body = new URLSearchParams({
    m: "QueryData",
    dbcode,
    rowcode: "zb",
    colcode: "sj",
    wds: "[]",
    dfwds: JSON.stringify([
      { wdcode: "zb", valuecode: indicatorCode },
      { wdcode: "sj", valuecode: periods.join(",") }
    ]),
    k1: String(Date.now())
  });
  const response = await fetch("https://data.stats.gov.cn/easyquery.htm", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Referer: "https://data.stats.gov.cn/easyquery.htm?cn=A01",
      "X-Requested-With": "XMLHttpRequest"
    },
    body,
    signal: AbortSignal.timeout(nbsDirectTimeoutMs())
  });
  if (!response.ok) throw new Error(`China NBS direct request failed with ${response.status}`);

  return parseChinaNbsEasyQueryObservations(await response.json(), series);
}

function parseChinaNbsEasyQueryObservations(payload: unknown, series: Series) {
  const data = payload as {
    returncode?: number;
    returndata?: {
      datanodes?: Array<{
        data?: { hasdata?: boolean; strdata?: string };
        wds?: Array<{ wdcode?: string; valuecode?: string }>;
      }>;
    };
  };
  if (data.returncode !== 200) throw new Error(`China NBS direct request returned ${data.returncode ?? "an invalid payload"}`);

  return (data.returndata?.datanodes ?? [])
    .map((node) => {
      const period = node.wds?.find((item) => item.wdcode === "sj")?.valuecode;
      const date = normalizeChinaNbsPeriod(period);
      if (!date || node.data?.hasdata === false || !node.data?.strdata) return undefined;
      return toObservation(date, node.data.strdata, observationFrequency(series.indicatorKey), "China NBS Direct", series.indicatorKey);
    })
    .filter((item): item is ProviderObservation => Boolean(item));
}

function imfIndicatorCode(indicatorKey: IndicatorKey): string | undefined {
  if (indicatorKey === "gdp_real") return "NGDP_RPCH";
  if (indicatorKey === "gdp_nominal") return "NGDPD";
  if (indicatorKey === "cpi" || indicatorKey === "inflation_rate") return "PCPIPCH";
  return undefined;
}

function imfSourceName(indicatorKey: IndicatorKey): string {
  if (indicatorKey === "gdp_real") return "IMF DataMapper WEO real GDP growth";
  if (indicatorKey === "gdp_nominal") return "IMF DataMapper WEO nominal GDP";
  if (indicatorKey === "inflation_rate") return "IMF DataMapper WEO inflation rate";
  return "IMF DataMapper WEO inflation";
}

async function fetchImfDataMapper(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  if (series.indicatorKey === "policy_rate") return emptyPayload("unavailable");

  const country = imfCountryCode(series.countryCode);
  if (!country) return emptyPayload("unavailable");

  const indicator = imfIndicatorCode(series.indicatorKey);
  if (!indicator) return emptyPayload("unavailable");

  const response = await fetch(`https://www.imf.org/external/datamapper/api/v1/${indicator}`);
  if (!response.ok) throw new Error(`IMF DataMapper request failed with ${response.status}`);

  const payload = (await response.json()) as { values?: Record<string, Record<string, Record<string, number>>> };
  const values = payload.values?.[indicator]?.[country] ?? {};
  const source = imfSourceName(series.indicatorKey);

  const observations = Object.entries(values)
    .map(([year, value]) => ({
      date: `${year}-12-31`,
      period: year,
      frequency: "annual" as const,
      value: roundValue(Number(value)),
      rawValue: Number(value),
      normalizedValue: roundValue(Number(value)),
      unit: "Annual percent change",
      source
    }))
    .filter((item) => Number.isFinite(item.value) && item.date >= historyStartDate(options))
    .sort((a, b) => a.date.localeCompare(b.date));

  return withReleases(observations, series, observations.length > 0 ? "fresh" : "stale");
}

async function fetchTaiwanOpenData(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  if (series.countryCode !== "TW") return emptyPayload("unavailable");
  if (series.indicatorKey === "policy_rate") return fetchTaiwanPolicyRate(series, options);
  if (series.indicatorKey !== "cpi" && series.indicatorKey !== "inflation_rate") return emptyPayload("unavailable");

  try {
    const metadataResponse = await fetch("https://data.gov.tw/api/v2/rest/dataset/9158");
    if (!metadataResponse.ok) throw new Error(`Taiwan open data metadata failed with ${metadataResponse.status}`);
    const metadata = await metadataResponse.json();
    const downloadUrl = findDownloadUrl(metadata, ["csv", "json", "xml"]);
    if (!downloadUrl) throw new Error("Taiwan CPI download URL not found");

    const dataResponse = await fetch(downloadUrl);
    if (!dataResponse.ok) throw new Error(`Taiwan CPI data failed with ${dataResponse.status}`);
    const rows = parseDataResource(await dataResponse.text(), downloadUrl);
    const observations = normalizeProviderObservations(rows
      .map((row) => taiwanCpiObservation(row, series.indicatorKey))
      .filter((item): item is ProviderObservation => Boolean(item))
      .sort((a, b) => a.date.localeCompare(b.date)), series.indicatorKey, "cpi_index")
      .filter((item) => item.date >= historyStartDate(options))
      .map((item) => ({
        ...item,
        unit: unitForSeries(series.countryCode, series.indicatorKey)
      }));

    if (observations.length > 0) return withReleases(observations, series, "fresh");
  } catch (error) {
    console.warn(`Taiwan open data CPI skipped: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  return emptyPayload("stale");
}

async function fetchTaiwanPolicyRate(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  const metadataResponse = await fetch("https://data.gov.tw/api/v2/rest/dataset/10783");
  if (!metadataResponse.ok) throw new Error(`Taiwan policy-rate metadata failed with ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  const downloadUrl = findDownloadUrl(metadata, ["csv"]);
  if (!downloadUrl) throw new Error("Taiwan policy-rate download URL not found");

  const dataResponse = await fetch(downloadUrl);
  if (!dataResponse.ok) throw new Error(`Taiwan policy-rate data failed with ${dataResponse.status}`);

  const observations = compressPolicyObservations(parseDelimited(await dataResponse.text())
    .map((row) => {
      const date = row["期間"] ?? row["日"] ?? row.period ?? row.date ?? row.Date;
      const value = row["重貼現"] ?? row["重貼現(%)"] ?? row["重貼現率(%)"] ?? row["Discounted rediscount"] ?? row.value;
      return toObservation(normalizeTaiwanDate(date ?? ""), value, "event", "Taiwan Central Bank Open Data", series.indicatorKey);
    })
    .filter((item): item is ProviderObservation => Boolean(item)), options);

  return withReleases(observations, series, observations.length > 0 ? "fresh" : "stale");
}

async function fetchWorldBank(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  const wbIndicator = worldBankIndicatorCode(series.indicatorKey);
  if (!wbIndicator) return emptyPayload("unavailable");
  if (series.indicatorKey === "policy_rate") return emptyPayload("unavailable");

  const country = worldBankCountryCode(series.countryCode);
  if (!country) return emptyPayload("unavailable");

  const url = new URL(`https://api.worldbank.org/v2/country/${country}/indicator/${wbIndicator}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("date", `1980:${options.now.getUTCFullYear()}`);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`World Bank request failed with ${response.status}`);

  const payload = (await response.json()) as Array<unknown>;
  const rawData = Array.isArray(payload) && payload.length > 1 ? (payload[1] as Array<{ value?: string | null; date?: string }> | null) : [];
  if (!rawData || !Array.isArray(rawData) || rawData.length === 0) return emptyPayload("stale");
  const source = `World Bank API (${wbIndicator})`;

  const rawObservations = rawData
    .filter((row) => row.value !== null && row.date !== undefined)
    .map((row) => {
      const year = String(row.date);
      return {
        date: `${year}-12-31`,
        period: year,
        frequency: "annual" as const,
        value: roundValue(Number(row.value)),
        rawValue: Number(row.value),
        normalizedValue: roundValue(Number(row.value)),
        unit: wbIndicator === "NY.GDP.MKTP.KD" || wbIndicator === "NY.GDP.MKTP.CD" ? "USD" : "Annual percent change",
        source
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const observations = normalizeProviderObservations(rawObservations, series.indicatorKey, series.indicatorKey === "cpi" ? "cpi_index" : "direct")
    .filter((item) => Number.isFinite(item.value) && item.date >= historyStartDate(options))
    .map((item) => ({
      ...item,
      unit: series.indicatorKey === "cpi" || series.indicatorKey === "inflation_rate" ? "YoY %" : item.unit
    }));

  return withReleases(observations, series, observations.length > 0 ? "fresh" : "stale");
}

function worldBankIndicatorCode(indicatorKey: IndicatorKey): string | undefined {
  if (indicatorKey === "gdp_real") return "NY.GDP.MKTP.KD";
  if (indicatorKey === "gdp_nominal") return "NY.GDP.MKTP.CD";
  if (indicatorKey === "cpi") return "FP.CPI.TOTL";
  if (indicatorKey === "inflation_rate") return "FP.CPI.TOTL.ZG";
  return undefined;
}

function worldBankCountryCode(countryCode: string): string | undefined {
  const codes: Record<string, string> = {
    US: "US",
    EU: "EUU",
    JP: "JPN",
    KR: "KOR",
    CN: "CHN",
    TW: "TWN"
  };
  return codes[countryCode];
}

async function fetchBlsCpi(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  if (series.countryCode !== "US" || series.indicatorKey !== "cpi") return emptyPayload("unavailable");

  const now = options.now;
  const body = {
    seriesid: ["CUSR0000SA0"],
    startyear: String(now.getUTCFullYear() - options.lookbackYears - 1),
    endyear: String(now.getUTCFullYear())
  };

  const response = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`BLS request failed with ${response.status}`);

  const payload = (await response.json()) as {
    Results?: { series?: Array<{ data?: Array<{ year?: string; period?: string; value?: string }> }> };
  };
  const rows = payload.Results?.series?.[0]?.data ?? [];
  const rawObservations = rows
    .map((row) => {
      const month = row.period?.replace("M", "");
      if (!row.year || !month || month === "13") return undefined;
      return toObservation(`${row.year}-${month.padStart(2, "0")}-01`, row.value, "monthly", "BLS Public Data API", series.indicatorKey);
    })
    .filter((item): item is ProviderObservation => Boolean(item))
    .sort((a, b) => a.date.localeCompare(b.date));
  const observations = normalizeProviderObservations(rawObservations, series.indicatorKey, "cpi_index");

  return withReleases(observations, series, "fresh");
}

async function fetchEurostat(series: Series, _options: Required<FetchOptions>): Promise<ProviderPayload> {
  const geo = series.countryCode === "EU" ? "EA20" : series.countryCode;

  if (series.indicatorKey === "gdp_real" || series.indicatorKey === "gdp_nominal") {
    const unit = series.indicatorKey === "gdp_real" ? "CLV10_MEUR" : "CP_MEUR";
    const url = new URL("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/namq_10_gdp");
    url.searchParams.set("format", "JSON");
    url.searchParams.set("geo", geo);
    url.searchParams.set("freq", "Q");
    url.searchParams.set("na_item", "B1GQ");
    url.searchParams.set("unit", unit);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Eurostat request failed with ${response.status}`);
    const payload = await response.json();
    const observations = normalizeEurostatObservations(
      parseEurostatJsonStat(payload, "quarterly", "Eurostat API"),
      series.indicatorKey
    );
    return withReleases(observations, series, observations.length > 0 ? "fresh" : "stale");
  }

  // CPI and inflation_rate share the HICP endpoint
  const url = new URL("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr");
  url.searchParams.set("format", "JSON");
  url.searchParams.set("geo", geo);
  url.searchParams.set("freq", "M");
  url.searchParams.set("coicop", "CP00");
  url.searchParams.set("unit", "RCH_A");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Eurostat request failed with ${response.status}`);
  const payload = await response.json();
  const observations = normalizeEurostatObservations(
    parseEurostatJsonStat(payload, "monthly", "Eurostat API"),
    series.indicatorKey
  );
  return withReleases(observations, series, observations.length > 0 ? "fresh" : "stale");
}

async function fetchEcbPolicy(series: Series, _options: Required<FetchOptions>): Promise<ProviderPayload> {
  const response = await fetch("https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.MRR_FR.LEV?format=csvdata");
  if (!response.ok) throw new Error(`ECB request failed with ${response.status}`);

  const rows = parseCsv(await response.text());
  const observations = compressPolicyObservations(rows
    .map((row) => toObservation(row.TIME_PERIOD ?? row.time_period, row.OBS_VALUE ?? row.obs_value, "event", "ECB Data Portal", series.indicatorKey))
    .filter((item): item is ProviderObservation => Boolean(item)), _options);

  return withReleases(observations, series, observations.length > 0 ? "fresh" : "stale");
}

async function fetchEstat(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  if (!process.env.ESTAT_APP_ID) throw new NeedsApiKeyError("Japan e-Stat");
  if (series.countryCode !== "JP") return emptyPayload("unavailable");

  const indicatorCode = estatIndicatorCode(series.indicatorKey);
  if (!indicatorCode) return emptyPayload("unavailable");
  if (!/^\d{19}$/.test(indicatorCode)) throw new Error("Japan e-Stat dashboard indicator code must be 19 digits");

  const url = new URL("https://dashboard.e-stat.go.jp/api/1.0/Json/getData");
  url.searchParams.set("Lang", "JP");
  url.searchParams.set("IndicatorCode", indicatorCode);
  url.searchParams.set("RegionCode", "00000");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Japan e-Stat request failed with ${response.status}`);

  const observations = parseEstatDashboardObservations(await response.json(), series, options);
  return withReleases(observations, series, observations.length > 0 ? "fresh" : "stale");
}

function estatIndicatorCode(indicatorKey: IndicatorKey): string | undefined {
  if (indicatorKey === "gdp_real") return process.env.ESTAT_GDP_STATS_DATA_ID;
  if (indicatorKey === "gdp_nominal") return process.env.ESTAT_GDP_NOMINAL_STATS_DATA_ID;
  if (indicatorKey === "cpi" || indicatorKey === "inflation_rate") return process.env.ESTAT_CPI_STATS_DATA_ID;
  return undefined;
}

async function fetchBisPolicyRate(series: Series, _options: Required<FetchOptions>): Promise<ProviderPayload> {
  const countryCode = bisPolicyCountryCodes[series.countryCode];
  if (!countryCode) return emptyPayload("unavailable");

  const url = new URL(`https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.${countryCode}`);
  url.searchParams.set("format", "csv");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`BIS request failed with ${response.status}`);

  const rows = parseCsv(await response.text());
  const observations = compressPolicyObservations(rows
    .map((row) =>
      toObservation(
        row.TIME_PERIOD ?? row.time_period ?? row.date ?? row.Date,
        row.OBS_VALUE ?? row.obs_value ?? row.value ?? row.Value,
        "event",
        "BIS WS_CBPOL",
        series.indicatorKey
      )
    )
    .filter((item): item is ProviderObservation => Boolean(item))
    .sort((a, b) => a.date.localeCompare(b.date)), _options);

  return withReleases(observations, series, observations.length > 0 ? "fresh" : "stale");
}

async function fetchBeaGdp(series: Series, options: Required<FetchOptions>): Promise<ProviderPayload> {
  if (series.countryCode !== "US" || series.indicatorKey !== "gdp_real") return emptyPayload("unavailable");

  const url = new URL("https://apps.bea.gov/api/data/");
  url.searchParams.set("UserID", process.env.BEA_API_KEY ?? "sampleUser");
  url.searchParams.set("method", "GetData");
  url.searchParams.set("datasetname", "NIPA");
  url.searchParams.set("TableName", "T10106");
  url.searchParams.set("LineNumber", "1");
  url.searchParams.set("Frequency", "Q");
  url.searchParams.set("Year", "ALL");
  url.searchParams.set("ResultFormat", "JSON");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`BEA request failed with ${response.status}`);

  const payload = (await response.json()) as { BEAAPI?: { Results?: { Data?: Array<{ TimePeriod?: string; DataValue?: string }> } } };
  const observations = (payload.BEAAPI?.Results?.Data ?? [])
    .map((row) => toObservation(row.TimePeriod, row.DataValue?.replaceAll(",", ""), "quarterly", "BEA NIPA", series.indicatorKey))
    .filter((item): item is ProviderObservation => Boolean(item))
    .filter((item) => item.date >= historyStartDate(options))
    .sort((a, b) => a.date.localeCompare(b.date));

  return withReleases(observations, series, observations.length > 0 ? "fresh" : "stale");
}

async function preferOfficialSource(series: Series, payload: ProviderPayload, options: Required<FetchOptions>) {
  if (payload.observations.length === 0) return { payload, warnings: [] };

  const calibrationAdapter = calibrationAdapterFor(series);
  if (!calibrationAdapter || calibrationAdapter.key === series.providerKey) return { payload, warnings: [] };

  try {
    const calibrationPayload = await calibrationAdapter.fetch(
      {
        ...series,
        providerKey: calibrationAdapter.key,
        source: calibrationAdapter.name
      },
      options
    );
    if (calibrationPayload.observations.length === 0) return { payload, warnings: [] };

    return {
      payload,
      warnings: compareObservations(payload.observations, calibrationPayload.observations, series.indicatorKey)
    };
  } catch (error) {
    console.warn(
      `Calibration comparison skipped for ${series.id}: ${error instanceof Error ? error.message : "unknown comparison error"}`
    );
    return { payload, warnings: [] };
  }
}

function fredSeriesId(indicatorKey: IndicatorKey) {
  if (indicatorKey === "gdp_real") return "GDPC1";
  if (indicatorKey === "gdp_nominal") return "GDP";
  if (indicatorKey === "cpi") return "CPIAUCSL";
  if (indicatorKey === "inflation_rate") return "FPCPITOTLZGUSA";
  return "FEDFUNDS";
}

type DbnomicsSeriesMapping = {
  providerCode: string;
  datasetCode: string;
  seriesCode: string;
  source: string;
  valueFormat: "direct" | "cpi_index" | "yoy_index";
};

type ChinaNbsCpiMapping = DbnomicsSeriesMapping & {
  fromYear: number;
  toYear?: number;
};

const chinaNominalGdpMapping: DbnomicsSeriesMapping = {
  providerCode: "NBS",
  datasetCode: "Q_A0101",
  seriesCode: "A010101",
  source: "DBnomics China NBS GDP",
  valueFormat: "direct"
};

const chinaNbsCpiMappings: ChinaNbsCpiMapping[] = [
  {
    providerCode: "NBS",
    datasetCode: "M_A010101",
    seriesCode: "A01010101",
    source: "DBnomics China NBS CPI",
    valueFormat: "yoy_index",
    fromYear: 2016,
    toYear: 2020
  },
  {
    providerCode: "NBS",
    datasetCode: "M_A01010G",
    seriesCode: "A01010G01",
    source: "DBnomics China NBS CPI",
    valueFormat: "yoy_index",
    fromYear: 2021,
    toYear: 2025
  },
  {
    providerCode: "NBS",
    datasetCode: "M_A01010J",
    seriesCode: "A01010J01",
    source: "DBnomics China NBS CPI",
    valueFormat: "yoy_index",
    fromYear: 2026
  }
];

const chinaImfCpiMapping: DbnomicsSeriesMapping = {
  providerCode: "IMF",
  datasetCode: "CPI",
  seriesCode: "M.CN.PCPI_IX",
  source: "DBnomics IMF CPI fallback",
  valueFormat: "cpi_index"
};

function dbnomicsSeriesFor(series: Series): DbnomicsSeriesMapping | undefined {
  if (series.countryCode === "KR") {
    if (series.indicatorKey === "gdp_real") {
      return {
        providerCode: "OECD",
        datasetCode: "QNA",
        seriesCode: "KOR.B1_GE.LNBQRSA.Q",
        source: "DBnomics OECD QNA",
        valueFormat: "direct"
      };
    }
    if (series.indicatorKey === "gdp_nominal") {
      return {
        providerCode: "OECD",
        datasetCode: "QNA",
        seriesCode: "KOR.B1_GE.CQRSA.Q",
        source: "DBnomics OECD QNA",
        valueFormat: "direct"
      };
    }
    if (series.indicatorKey === "cpi" || series.indicatorKey === "inflation_rate") {
      return {
        providerCode: "IMF",
        datasetCode: "CPI",
        seriesCode: "M.KR.PCPI_IX",
        source: "DBnomics IMF CPI",
        valueFormat: "cpi_index"
      };
    }
  }

  if (series.countryCode === "CN") {
    if (series.indicatorKey === "gdp_real") {
      return {
        providerCode: "NBS",
        datasetCode: "Q_A0103",
        seriesCode: "A010301",
        source: "DBnomics China NBS GDP index",
        valueFormat: "direct"
      };
    }
    if (series.indicatorKey === "gdp_nominal") {
      return chinaNominalGdpMapping;
    }
    if (series.indicatorKey === "cpi" || series.indicatorKey === "inflation_rate") {
      return chinaImfCpiMapping;
    }
  }

  return {
    providerCode: "FRED",
    datasetCode: dbnomicsFredSeriesCode(series.indicatorKey),
    seriesCode: dbnomicsFredSeriesCode(series.indicatorKey),
    source: "DBnomics FRED mirror",
    valueFormat: series.indicatorKey === "cpi" ? "cpi_index" : "direct"
  };
}

function dbnomicsFredSeriesCode(indicatorKey: IndicatorKey) {
  if (indicatorKey === "gdp_real") return "GDPC1";
  if (indicatorKey === "gdp_nominal") return "GDP";
  if (indicatorKey === "cpi") return "CPIAUCSL";
  if (indicatorKey === "inflation_rate") return "FPCPITOTLZGUSA";
  return "FEDFUNDS";
}

function observationFrequency(indicatorKey: IndicatorKey): DataFrequency {
  if (indicatorKey === "gdp_real" || indicatorKey === "gdp_nominal") return "quarterly";
  if (indicatorKey === "cpi" || indicatorKey === "inflation_rate") return "monthly";
  return "event";
}

function releaseEventType(indicatorKey: IndicatorKey): "gdp_release" | "cpi_release" | "inflation_release" | "rate_decision" {
  if (indicatorKey === "gdp_real" || indicatorKey === "gdp_nominal") return "gdp_release";
  if (indicatorKey === "inflation_rate") return "inflation_release";
  if (indicatorKey === "cpi") return "cpi_release";
  return "rate_decision";
}

function toObservation(
  dateValue: unknown,
  rawValue: unknown,
  frequency: DataFrequency,
  source: string,
  indicatorKey: IndicatorKey
): ProviderObservation | undefined {
  const value = Number(rawValue);
  if (typeof dateValue !== "string" || !Number.isFinite(value)) return undefined;
  const date = normalizeDate(dateValue);
  const normalizedValue = normalizeRawValue(value);

  return {
    date,
    period: periodFor(date, frequency),
    frequency,
    value: roundValue(normalizedValue),
    rawValue: value,
    normalizedValue: roundValue(normalizedValue),
    source
  };
}

function normalizeProviderObservations(
  observations: ProviderObservation[],
  indicatorKey: IndicatorKey,
  valueFormat: "direct" | "cpi_index" | "yoy_index" = "direct"
): ProviderObservation[] {
  if ((indicatorKey === "cpi" || indicatorKey === "inflation_rate") && valueFormat === "yoy_index") {
    return observations.map((item) => ({
      ...item,
      value: roundValue(item.value - 100),
      normalizedValue: roundValue(item.value - 100)
    }));
  }

  if ((indicatorKey !== "cpi" && indicatorKey !== "inflation_rate") || valueFormat !== "cpi_index") return observations;

  const byPeriod = new Map(observations.map((item) => [item.period, item]));
  const normalized: ProviderObservation[] = [];

  for (const item of observations) {
    if (!item.period || item.rawValue === undefined) continue;

    const previousYearPeriod = item.period.length === 4 ? `${Number(item.period) - 1}` : `${Number(item.period.slice(0, 4)) - 1}-${item.period.slice(5, 7)}`;
    const previous = byPeriod.get(previousYearPeriod);
    if (!previous?.rawValue) continue;

    const annualRate = ((item.rawValue - previous.rawValue) / previous.rawValue) * 100;
    normalized.push({
      ...item,
      value: roundValue(annualRate),
      normalizedValue: roundValue(annualRate)
    });
  }

  return normalized;
}

function normalizeDbnomicsObservations(observations: ProviderObservation[], series: Series) {
  if (series.countryCode === "KR" && (series.indicatorKey === "gdp_real" || series.indicatorKey === "gdp_nominal")) {
    return observations.map((item) => {
      const normalizedValue = roundValue(item.value / 1000);
      return {
        ...item,
        value: normalizedValue,
        normalizedValue,
        unit: unitForSeries(series.countryCode, series.indicatorKey)
      };
    });
  }

  if (series.countryCode === "KR" && (series.indicatorKey === "cpi" || series.indicatorKey === "inflation_rate")) {
    return observations.map((item) => ({
      ...item,
      unit: unitForSeries(series.countryCode, series.indicatorKey)
    }));
  }

  if (series.countryCode === "CN" && series.indicatorKey === "gdp_nominal") {
    return observations.map((item) => {
      const normalizedValue = roundValue(item.value / 10);
      return {
        ...item,
        value: normalizedValue,
        normalizedValue,
        unit: unitForSeries(series.countryCode, series.indicatorKey)
      };
    });
  }

  if (series.countryCode === "CN" && series.indicatorKey === "gdp_real") {
    return observations.map((item) => ({
      ...item,
      value: roundValue(item.value - 100),
      normalizedValue: roundValue(item.value - 100),
      unit: "YoY %",
      revisionTag: "gdp_index_yoy"
    }));
  }

  if (series.countryCode === "CN" && (series.indicatorKey === "cpi" || series.indicatorKey === "inflation_rate")) {
    return observations.map((item) => ({
      ...item,
      unit: unitForSeries(series.countryCode, series.indicatorKey)
    }));
  }

  return observations;
}

function normalizeChinaNbsObservations(observations: ProviderObservation[], series: Series) {
  if (series.indicatorKey === "gdp_nominal") {
    return observations.map((item) => {
      const normalizedValue = roundValue(item.value / 10);
      return {
        ...item,
        value: normalizedValue,
        normalizedValue,
        unit: unitForSeries(series.countryCode, series.indicatorKey)
      };
    });
  }

  return observations.map((item) => {
    const normalizedValue = roundValue(item.value - 100);
    return {
      ...item,
      value: normalizedValue,
      normalizedValue,
      unit: unitForSeries(series.countryCode, series.indicatorKey)
    };
  });
}

function normalizeEurostatObservations(observations: ProviderObservation[], indicatorKey: IndicatorKey) {
  if (indicatorKey !== "gdp_real" && indicatorKey !== "gdp_nominal") return observations;

  return observations.map((item) => {
    const normalizedValue = roundValue(item.value / 1000);
    return {
      ...item,
      value: normalizedValue,
      normalizedValue,
      rawValue: item.rawValue
    };
  });
}

function normalizeRawValue(value: number) {
  return value;
}

function roundValue(value: number) {
  return Number(value.toFixed(4));
}

function compareObservations(primary: ProviderObservation[], comparison: ProviderObservation[], indicatorKey: IndicatorKey) {
  const tolerance = indicatorKey === "gdp_real" ? 0.1 : 0.05;
  const comparisonByPeriod = new Map(comparison.map((item) => [item.period ?? item.date, item]));
  const comparisonByYear = new Map(comparison.map((item) => [String(item.period ?? item.date).slice(0, 4), item]));
  const warnings: SourceComparisonWarning[] = [];

  for (const item of primary.slice(-24)) {
    const period = item.period ?? item.date;
    const other = comparisonByPeriod.get(period) ?? comparisonByYear.get(period.slice(0, 4));
    if (!other) continue;

    const difference = roundValue(item.value - other.value);
    if (Math.abs(difference) <= tolerance) continue;

    warnings.push({
      period,
      primarySource: item.source,
      comparisonSource: other.source,
      primaryValue: item.value,
      comparisonValue: other.value,
      difference
    });
  }

  return warnings;
}

function dedupeSourceComparisonWarnings(warnings: SourceComparisonWarning[]) {
  const byComparison = new Map<string, SourceComparisonWarning>();
  for (const warning of warnings) {
    byComparison.set([warning.period, warning.primarySource, warning.comparisonSource].join(":"), warning);
  }
  return Array.from(byComparison.values());
}

function mergeObservationSources(sources: ProviderObservation[][]) {
  const byPeriod = new Map<string, ProviderObservation>();
  for (const observations of sources) {
    for (const observation of observations) {
      const key = observation.period ?? observation.date;
      if (!byPeriod.has(key)) byPeriod.set(key, observation);
    }
  }
  return Array.from(byPeriod.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function chinaCpiMappingOverlapsOptions(mapping: ChinaNbsCpiMapping, options: Required<FetchOptions>) {
  const startYear = options.now.getUTCFullYear() - options.lookbackYears - 1;
  const endYear = options.now.getUTCFullYear();
  return mapping.fromYear <= endYear && (mapping.toYear === undefined || mapping.toYear >= startYear);
}

function chinaCpiMappingIncludesYear(mapping: ChinaNbsCpiMapping, year: number) {
  return year >= mapping.fromYear && (mapping.toYear === undefined || year <= mapping.toYear);
}

function filterChinaCpiMappingRange(observations: ProviderObservation[], mapping: ChinaNbsCpiMapping) {
  return observations.filter((observation) => chinaCpiMappingIncludesYear(mapping, Number(observation.date.slice(0, 4))));
}

function nbsDirectEnabled() {
  return process.env.NBS_DIRECT_ENABLED === "true";
}

function nbsDirectTimeoutMs() {
  const value = Number(process.env.NBS_DIRECT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 8000;
}

function nbsYearPeriods(options: Required<FetchOptions>) {
  const endYear = options.now.getUTCFullYear();
  const startYear = options.mode === "history" ? endYear - options.lookbackYears : endYear - 1;
  return Array.from({ length: endYear - startYear + 1 }, (_, index) => String(startYear + index));
}

function nbsMonthlyPeriods(options: Required<FetchOptions>) {
  const end = new Date(Date.UTC(options.now.getUTCFullYear(), options.now.getUTCMonth(), 1));
  const startYear = options.mode === "history" ? options.now.getUTCFullYear() - options.lookbackYears - 1 : options.now.getUTCFullYear() - 1;
  const current = new Date(Date.UTC(startYear, 0, 1));
  const periods: string[] = [];

  while (current <= end) {
    periods.push(`${current.getUTCFullYear()}${String(current.getUTCMonth() + 1).padStart(2, "0")}`);
    current.setUTCMonth(current.getUTCMonth() + 1);
  }

  return periods;
}

function calibrationAdapterFor(series: Series): ProviderAdapter | undefined {
  if (series.indicatorKey === "gdp_real" || series.indicatorKey === "gdp_nominal" || series.indicatorKey === "cpi" || series.indicatorKey === "inflation_rate") {
    return worldBankAdapter;
  }

  return undefined;
}

function parseDbnomicsObservations(payload: unknown, series: Series, source: string) {
  const docs = dbnomicsDocs(payload);
  const observations: ProviderObservation[] = [];

  for (const doc of docs) {
    const values = dbnomicsValues(doc);

    for (const [period, rawValue] of Object.entries(values)) {
      const frequency = frequencyFromPeriod(period, series.indicatorKey);
      const observation = toObservation(period, rawValue, frequency, source, series.indicatorKey);
      if (observation) observations.push(observation);
    }
  }

  return observations;
}

function parseEstatDashboardObservations(payload: unknown, series: Series, options: Required<FetchOptions>) {
  const data = payload as {
    GET_STATS?: {
      RESULT?: { status?: string; errorMsg?: string };
      STATISTICAL_DATA?: {
        DATA_INF?: {
          DATA_OBJ?: Array<{ VALUE?: EstatDashboardValue | EstatDashboardValue[] }> | { VALUE?: EstatDashboardValue | EstatDashboardValue[] };
        };
      };
    };
  };
  const result = data.GET_STATS?.RESULT;
  if (result?.status && result.status !== "0") throw new Error(result.errorMsg ?? `Japan e-Stat request failed with status ${result.status}`);

  const dataObjects = asArray(data.GET_STATS?.STATISTICAL_DATA?.DATA_INF?.DATA_OBJ);
  const frequency = estatDashboardFrequency(series.indicatorKey);
  const seasonalCode = estatDashboardSeasonalCode(series.indicatorKey);
  const observations = dataObjects
    .flatMap((item) => asArray(item.VALUE))
    .filter((item) => item["@regionCode"] === "00000" && item["@regionRank"] === "2")
    .filter((item) => item["@cycle"] === estatDashboardCycleCode(frequency) && item["@isSeasonal"] === seasonalCode)
    .map((item) => estatDashboardObservation(item, series, frequency))
    .filter((item): item is ProviderObservation => Boolean(item))
    .filter((item) => item.date >= historyStartDate(options))
    .sort((a, b) => a.date.localeCompare(b.date));

  return observations;
}

type EstatDashboardValue = {
  "@time"?: string;
  "@cycle"?: string;
  "@regionCode"?: string;
  "@regionRank"?: string;
  "@isSeasonal"?: string;
  "@isProvisional"?: string;
  "$"?: string;
};

function estatDashboardFrequency(indicatorKey: IndicatorKey): DataFrequency {
  if (indicatorKey === "cpi" || indicatorKey === "inflation_rate") return "monthly";
  return "quarterly";
}

function estatDashboardCycleCode(frequency: DataFrequency) {
  if (frequency === "monthly") return "1";
  return "2";
}

function estatDashboardSeasonalCode(indicatorKey: IndicatorKey) {
  if (indicatorKey === "cpi" || indicatorKey === "inflation_rate") return "1";
  return "2";
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function estatDashboardObservation(value: EstatDashboardValue, series: Series, frequency: DataFrequency): ProviderObservation | undefined {
  const date = estatDashboardDate(value["@time"], frequency);
  const rawValue = Number(value.$);
  if (!date || !Number.isFinite(rawValue)) return undefined;

  return {
    date,
    period: periodFor(date, frequency),
    frequency,
    value: roundValue(rawValue),
    rawValue,
    normalizedValue: roundValue(rawValue),
    revisionTag: value["@isProvisional"] === "1" ? "provisional" : undefined,
    unit: series.unit ?? unitForSeries(series.countryCode, series.indicatorKey),
    source: "Japan e-Stat Dashboard"
  };
}

function estatDashboardDate(time: string | undefined, frequency: DataFrequency) {
  if (!time) return undefined;
  if (frequency === "monthly") {
    const monthly = /^(\d{4})(\d{2})00$/.exec(time);
    if (monthly) return `${monthly[1]}-${monthly[2]}-01`;
  }
  const quarterly = /^(\d{4})([1-4])Q00$/.exec(time);
  if (quarterly) {
    const [, year, quarter] = quarterly;
    return `${year}-${["03-31", "06-30", "09-30", "12-31"][Number(quarter) - 1]}`;
  }
  return normalizeDate(time.replace("CY00", ""));
}

function dbnomicsDocs(payload: unknown): Array<{ values?: Record<string, unknown>; period?: string[]; value?: unknown[] }> {
  const data = payload as {
    series?: { docs?: Array<{ values?: Record<string, unknown>; period?: string[]; value?: unknown[] }> };
    docs?: Array<{ values?: Record<string, unknown>; period?: string[]; value?: unknown[] }>;
  };
  return data.series?.docs ?? data.docs ?? [];
}

function dbnomicsValues(doc: { values?: Record<string, unknown>; period?: string[]; value?: unknown[] }) {
  if (doc.values && typeof doc.values === "object" && !Array.isArray(doc.values)) return doc.values;
  if (!Array.isArray(doc.period) || !Array.isArray(doc.value)) return {};

  return Object.fromEntries(doc.period.map((period, index) => [period, doc.value?.[index]]));
}

function frequencyFromPeriod(period: string, indicatorKey: IndicatorKey): DataFrequency {
  if (/^\d{4}-Q[1-4]$/.test(period)) return "quarterly";
  if (/^\d{4}-\d{2}$/.test(period)) return "monthly";
  if (indicatorKey === "gdp_real" || indicatorKey === "gdp_nominal") return "quarterly";
  if (indicatorKey === "cpi" || indicatorKey === "inflation_rate") return "monthly";
  return "event";
}

function historyStartDate(options: Required<FetchOptions>) {
  const start = new Date(Date.UTC(options.now.getUTCFullYear() - options.lookbackYears, options.now.getUTCMonth(), options.now.getUTCDate()));
  start.setUTCMonth(0, 1);
  return start.toISOString().slice(0, 10);
}

function providerHistoryStartDate(series: Series, options: Required<FetchOptions>) {
  const extraYears = (series.indicatorKey === "cpi" || series.indicatorKey === "inflation_rate") ? 1 : 0;
  const start = new Date(
    Date.UTC(options.now.getUTCFullYear() - options.lookbackYears - extraYears, options.now.getUTCMonth(), options.now.getUTCDate())
  );
  start.setUTCMonth(0, 1);
  return start.toISOString().slice(0, 10);
}

function withReleases(observations: ProviderObservation[], series: Series, sourceStatus: SourceStatus): ProviderPayload {
  const releases = releaseObservations(observations, series.indicatorKey).map((point) => ({
    eventType: releaseEventType(series.indicatorKey),
    date: point.date,
    period: point.period,
    actual: point.value,
    source: point.source,
    sourceUrl: series.sourceUrl
  })) satisfies ProviderReleaseEvent[];

  return { observations, releases, sourceStatus };
}

function releaseObservations(observations: ProviderObservation[], indicatorKey: IndicatorKey) {
  if (indicatorKey !== "policy_rate") return observations;

  const releases: ProviderObservation[] = [];
  let previousValue: number | undefined;
  for (const observation of observations.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    if (previousValue === undefined || observation.value !== previousValue) releases.push(observation);
    previousValue = observation.value;
  }
  return releases;
}

function compressPolicyObservations(observations: ProviderObservation[], options: Required<FetchOptions>) {
  const sorted = observations
    .filter((item) => item.date >= historyStartDate(options))
    .sort((a, b) => a.date.localeCompare(b.date));
  const compressed: ProviderObservation[] = [];
  let previousValue: number | undefined;

  for (const observation of sorted) {
    if (previousValue === undefined || observation.value !== previousValue) {
      compressed.push(observation);
    }
    previousValue = observation.value;
  }

  const latest = sorted.at(-1);
  if (latest && compressed.at(-1)?.date !== latest.date) compressed.push(latest);
  return compressed;
}

function emptyPayload(sourceStatus: SourceStatus): ProviderPayload {
  return { observations: [], releases: [], sourceStatus };
}

function normalizeDate(value: string) {
  if (/^\d{4}$/.test(value)) return `${value}-12-31`;
  if (/^\d{4}Q[1-4]$/.test(value)) return normalizeDate(`${value.slice(0, 4)}-Q${value.slice(5)}`);
  if (/^\d{4}-Q[1-4]$/.test(value)) {
    const [year, quarter] = value.split("-Q");
    return `${year}-${["03-31", "06-30", "09-30", "12-31"][Number(quarter) - 1]}`;
  }
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  return value.slice(0, 10);
}

function normalizeChinaNbsPeriod(value: string | undefined) {
  if (!value) return undefined;
  if (/^\d{6}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-01`;
  if (/^\d{4}[A-D]$/.test(value)) {
    const quarter = value.charCodeAt(4) - "A".charCodeAt(0) + 1;
    return `${value.slice(0, 4)}-${["03-31", "06-30", "09-30", "12-31"][quarter - 1]}`;
  }
  return normalizeDate(value);
}

function periodFor(date: string, frequency: DataFrequency) {
  if (frequency === "quarterly") return `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
  if (frequency === "monthly") return date.slice(0, 7);
  return date.slice(0, 10);
}

function parseEurostatJsonStat(payload: unknown, frequency: DataFrequency, source: string) {
  const data = payload as {
    value?: Record<string, number> | number[];
    dimension?: { time?: { category?: { index?: Record<string, number> } } };
    id?: string[];
    size?: number[];
  };
  const timeIndex = data.dimension?.time?.category?.index ?? {};
  const labelsByIndex = new Map(Object.entries(timeIndex).map(([label, index]) => [index, label]));
  const values: Array<{ index: number; value: number }> = Array.isArray(data.value)
    ? data.value.map((value, index) => ({ index, value }))
    : Object.entries(data.value ?? {}).map(([index, value]) => ({ index: Number(index), value }));

  return values
    .map((entry) => toObservation(labelsByIndex.get(entry.index), entry.value, frequency, source, frequency === "monthly" ? "cpi" : "gdp_real"))
    .filter((item): item is ProviderObservation => Boolean(item))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function imfCountryCode(countryCode: string) {
  const codes: Record<string, string> = {
    JP: "JPN",
    KR: "KOR",
    CN: "CHN",
    TW: "TWN"
  };
  return codes[countryCode];
}

function findDownloadUrl(metadata: unknown, formats = ["csv", "json"]): string | undefined {
  const text = JSON.stringify(metadata);
  for (const format of formats) {
    const match = text.match(new RegExp(`https?:\\/\\/[^"]+\\.${format}`, "i"));
    if (match?.[0]) return match[0].replaceAll("\\/", "/");
  }
  return undefined;
}

function parseDataResource(input: string, downloadUrl: string): Array<Record<string, string>> {
  if (/\.xml(?:$|\?)/i.test(downloadUrl) || /^\s*</.test(input)) {
    return parseXmlRows(input);
  }

  if (/\.json(?:$|\?)/i.test(downloadUrl)) {
    const payload = JSON.parse(input) as unknown;
    if (Array.isArray(payload)) return payload.filter(isStringRecord);
  }

  return parseDelimited(input);
}

function parseXmlRows(input: string) {
  const rows: Array<Record<string, string>> = [];
  const rowPattern = /<([A-Za-z_][\w:.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;

  function visit(fragment: string) {
    rowPattern.lastIndex = 0;
    const matches = Array.from(fragment.matchAll(rowPattern));
    for (const match of matches) {
      const body = match[2] ?? "";
      const row = xmlChildRecord(body);
      if (row.TIME_PERIOD && row.Item_VALUE) rows.push(row);
      visit(body);
    }
  }

  visit(input);
  return dedupeRows(rows, (row) => Object.entries(row).map(([key, value]) => `${key}:${value}`).join("|"));
}

function xmlChildRecord(input: string) {
  const row: Record<string, string> = {};
  const childPattern = /<([A-Za-z_][\w:.-]*)\b[^>]*>([^<>]*)<\/\1>/g;
  for (const match of input.matchAll(childPattern)) {
    row[stripXmlNamespace(match[1] ?? "")] = decodeXmlEntities(match[2] ?? "").trim();
  }
  return row;
}

function stripXmlNamespace(value: string) {
  return value.includes(":") ? value.split(":").at(-1) ?? value : value;
}

function decodeXmlEntities(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function dedupeRows<T>(rows: T[], keyForRow: (row: T) => string) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = keyForRow(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseDelimited(input: string) {
  const delimiter = input.includes("\t") ? "\t" : ",";
  const lines = input.trim().split(/\r?\n/);
  const headers = splitCsvLine(lines[0] ?? "", delimiter);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [stripBom(header).trim(), values[index] ?? ""]));
  });
}

function taiwanCpiObservation(row: Record<string, string>, indicatorKey: IndicatorKey): ProviderObservation | undefined {
  const dateValue = row.TIME_PERIOD ?? row.period ?? row.date ?? Object.entries(row).find(([key]) => /年|月|date|period|年月/i.test(key))?.[1];
  const rawValue = row.Item_VALUE ?? row.value ?? Object.entries(row).find(([key]) => /年增率|漲跌|指數|CPI|value/i.test(key))?.[1];
  const itemName = `${row.Item ?? ""} ${row.TYPE ?? ""}`.trim();
  if (itemName && !/總指數|總計|總平均|all items|consumer price index/i.test(itemName)) return undefined;
  if (!dateValue || !rawValue) return undefined;

  return toObservation(normalizeTaiwanDate(dateValue), rawValue.replace("%", ""), "monthly", "Taiwan Government Open Data", indicatorKey);
}

function normalizeTaiwanDate(value: string) {
  const trimmed = value.trim();
  const compactDateMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactDateMatch) return `${compactDateMatch[1]}-${compactDateMatch[2]}-${compactDateMatch[3]}`;
  const compactMonthMatch = trimmed.match(/^(\d{4})(\d{2})$/);
  if (compactMonthMatch) return `${compactMonthMatch[1]}-${compactMonthMatch[2]}-01`;
  const periodMatch = trimmed.match(/^(\d{4})[-/]?M(\d{1,2})$/i);
  if (periodMatch) return `${periodMatch[1]}-${periodMatch[2].padStart(2, "0")}-01`;
  const rocMatch = trimmed.match(/^(\d{2,3})[年/-](\d{1,2})/);
  if (rocMatch) {
    return `${Number(rocMatch[1]) + 1911}-${rocMatch[2].padStart(2, "0")}-01`;
  }
  const westernMatch = trimmed.match(/^(\d{4})[年/-](\d{1,2})/);
  if (westernMatch) return `${westernMatch[1]}-${westernMatch[2].padStart(2, "0")}-01`;
  return trimmed;
}

function stripBom(value: string) {
  return value.replace(/^\uFEFF/, "");
}

function parseCsv(input: string) {
  const lines = input.trim().split(/\r?\n/);
  const headers = splitCsvLine(lines[0] ?? "");

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function splitCsvLine(line: string, delimiter = ",") {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}
