import type { Country, DataProvider, Indicator, IndicatorKey, Series } from "../types.js";

export const countries: Country[] = [
  { code: "US", nameZh: "美國", nameEn: "United States", region: "north_america" },
  { code: "EU", nameZh: "歐元區 / ECB口徑", nameEn: "Euro Area / ECB Scope", region: "europe" },
  { code: "JP", nameZh: "日本", nameEn: "Japan", region: "east_asia" },
  { code: "KR", nameZh: "韓國", nameEn: "South Korea", region: "east_asia" },
  { code: "CN", nameZh: "中國", nameEn: "China", region: "china" },
  { code: "TW", nameZh: "台灣", nameEn: "Taiwan", region: "east_asia" }
];

export const indicators: Indicator[] = [
  { key: "gdp_real", nameZh: "實質 GDP", nameEn: "Real GDP", unit: "series currency unit", frequency: "quarterly" },
  { key: "gdp_nominal", nameZh: "名目 GDP", nameEn: "Nominal GDP", unit: "series currency unit", frequency: "quarterly" },
  { key: "cpi", nameZh: "CPI", nameEn: "Consumer Price Index", unit: "YoY %", frequency: "monthly" },
  { key: "inflation_rate", nameZh: "通膨率", nameEn: "Inflation Rate", unit: "%", frequency: "monthly" },
  { key: "policy_rate", nameZh: "政策利率", nameEn: "Policy Rate", unit: "%", frequency: "event" },
  { key: "lpr", nameZh: "一年期 LPR", nameEn: "1-Year LPR", unit: "%", frequency: "event" }
];

const bisPolicyCountries: Record<string, string> = {
  US: "US",
  EU: "XM",
  JP: "JP",
  KR: "KR",
  CN: "CN",
  TW: "TW"
};

export const dataProviders: DataProvider[] = [
  {
    key: "fred",
    name: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/docs/api/fred/series_observations.html",
    priority: 10,
    requiresApiKey: true,
    status: process.env.FRED_API_KEY ? "pending" : "needs_api_key",
    coverage: "US GDP, CPI fallback, Fed policy rate"
  },
  {
    key: "bls",
    name: "BLS Public Data API",
    sourceUrl: "https://www.bls.gov/developers/",
    priority: 20,
    requiresApiKey: false,
    status: "pending",
    coverage: "US CPI monthly"
  },
  {
    key: "dbnomics",
    name: "DBnomics",
    sourceUrl: "https://api.db.nomics.world/",
    priority: 25,
    requiresApiKey: false,
    status: "pending",
    coverage: "Free OECD/IMF/NBS mirror for Korea GDP/CPI and China GDP/CPI"
  },
  {
    key: "world_bank",
    name: "World Bank API",
    sourceUrl: "https://api.worldbank.org/v2/",
    priority: 23,
    requiresApiKey: false,
    status: "pending",
    coverage: "Calibration-only annual benchmark data; never displayed as a dashboard source"
  },
  {
    key: "imf_datamapper",
    name: "IMF DataMapper API",
    sourceUrl: "https://www.imf.org/external/datamapper/api/v1/",
    priority: 24,
    requiresApiKey: false,
    status: "pending",
    coverage: "Calibration helper for Japan, Korea, China, and Taiwan GDP/CPI annual history"
  },
  {
    key: "taiwan_open_data",
    name: "Taiwan Government Open Data",
    sourceUrl: "https://data.gov.tw/",
    priority: 26,
    requiresApiKey: false,
    status: "pending",
    coverage: "Taiwan CPI and central-bank policy-rate open data; GDP waits for a stable official quarterly level table"
  },
  {
    key: "eurostat",
    name: "Eurostat API",
    sourceUrl: "https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-detailed-guidelines",
    priority: 30,
    requiresApiKey: false,
    status: "pending",
    coverage: "Euro area GDP and HICP for investor-focused European macro"
  },
  {
    key: "ecb",
    name: "ECB Data Portal",
    sourceUrl: "https://data.ecb.europa.eu/help/api/overview",
    priority: 35,
    requiresApiKey: false,
    status: "pending",
    coverage: "Euro area policy rate and monetary policy events"
  },
  {
    key: "bis",
    name: "BIS WS_CBPOL",
    sourceUrl: "https://data.bis.org/topics/CBPOL",
    priority: 40,
    requiresApiKey: false,
    status: "pending",
    coverage: "Cross-country policy-rate history fallback"
  },
  {
    key: "estat",
    name: "Japan e-Stat API",
    sourceUrl: "https://www.e-stat.go.jp/api/",
    priority: 42,
    requiresApiKey: true,
    registrationUrl: "https://www.e-stat.go.jp/api/api-dev/request",
    status: process.env.ESTAT_APP_ID ? "pending" : "needs_api_key",
    coverage: "Japan official GDP/CPI after free appId registration"
  },
  {
    key: "china_nbs_dbnomics",
    name: "China NBS composite",
    sourceUrl: "https://api.db.nomics.world/v22/datasets/NBS",
    priority: 45,
    requiresApiKey: false,
    status: "pending",
    coverage: "China nominal GDP and CPI from NBS mirror with optional NBS EasyQuery direct reads; IMF CPI fills missing periods"
  }
];

export const series: Series[] = countries.flatMap((country) =>
  indicators
    .filter((indicator) => {
      // Exclude policy_rate for China (LPR is separate)
      if (country.code === "CN" && indicator.key === "policy_rate") return false;
      // LPR only for China
      if (indicator.key === "lpr" && country.code !== "CN") return false;
      return true;
    })
    .map((indicator): Series => {
    const id = `${country.code}-${indicator.key}`;

    const provider = providerFor(country.code, indicator.key);

    if (indicator.key === "policy_rate") {
      const bisCode = bisPolicyCountries[country.code];
      const source = provider.key === "ecb" ? "ECB Data Portal" : provider.key === "fred" ? "FRED" : provider.name;
      return {
        id,
        countryCode: country.code,
        indicatorKey: indicator.key,
        source,
        unit: unitForSeries(country.code, indicator.key),
        sourceUrl: provider.key === "fred"
          ? "https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS"
          : provider.key === "ecb"
            ? "https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.MRR_FR.LEV"
            : provider.sourceUrl && provider.key !== "bis"
              ? provider.sourceUrl
              : bisCode
          ? `https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.${bisCode}?format=csv`
          : "https://data.bis.org/topics/CBPOL",
        status: provider.status === "unavailable" ? "unavailable" : "real",
        sourceStatus: provider.status,
        providerKey: provider.key
      };
    }

    return {
      id,
      countryCode: country.code,
      indicatorKey: indicator.key,
      source: provider.name,
      unit: unitForSeries(country.code, indicator.key),
      sourceUrl: provider.sourceUrl,
      status: provider.status === "unavailable" ? "unavailable" : "real",
      sourceStatus: provider.status,
      providerKey: provider.key
    };
  })
);

export const bisPolicyCountryCodes = bisPolicyCountries;

type ProviderChoice = Pick<DataProvider, "key" | "name" | "status"> & Pick<Partial<DataProvider>, "sourceUrl">;

function providerFor(countryCode: string, indicatorKey: IndicatorKey): ProviderChoice {
  if (countryCode === "US") {
    if (indicatorKey === "cpi") return provider("bls");
    return provider("fred");
  }

  // GDP indicators (real and nominal) share the same provider logic
  if (indicatorKey === "gdp_real" || indicatorKey === "gdp_nominal") {
    if (countryCode === "EU") return provider("eurostat");
    if (countryCode === "JP") {
      const jpGdpSeriesIdEnv = indicatorKey === "gdp_nominal" ? "ESTAT_GDP_NOMINAL_STATS_DATA_ID" : "ESTAT_GDP_STATS_DATA_ID";
      return configuredOfficialProvider("estat", "ESTAT_APP_ID", jpGdpSeriesIdEnv);
    }
    if (countryCode === "KR") return provider("dbnomics");
    if (countryCode === "CN") {
      if (indicatorKey === "gdp_real") return unavailableOfficialProvider(countryCode, indicatorKey);
      return provider("china_nbs_dbnomics");
    }
    return unavailableOfficialProvider(countryCode, indicatorKey);
  }

  // CPI and inflation rate share the same provider logic
  if (indicatorKey === "cpi" || indicatorKey === "inflation_rate") {
    if (countryCode === "EU") return provider("eurostat");
    if (countryCode === "TW") return provider("taiwan_open_data");
    if (countryCode === "JP") return configuredOfficialProvider("estat", "ESTAT_APP_ID", "ESTAT_CPI_STATS_DATA_ID");
    if (countryCode === "KR") return provider("dbnomics");
    if (countryCode === "CN") return provider("china_nbs_dbnomics");
    return unavailableOfficialProvider(countryCode, indicatorKey);
  }

  // LPR: China only, use BIS WS_CBPOL which has CN data
  if (indicatorKey === "lpr") return provider("bis");

  if (countryCode === "TW") return provider("taiwan_open_data");
  if (countryCode === "EU") return provider("ecb");
  return provider("bis");
}

function provider(key: string): ProviderChoice {
  const item = dataProviders.find((candidate) => candidate.key === key);
  if (!item) return { key, name: key, status: "unavailable" };
  return item;
}

function configuredOfficialProvider(key: string, apiKeyEnv: string, ...seriesEnvNames: string[]): ProviderChoice {
  const item = provider(key);
  if (!process.env[apiKeyEnv]) return { ...item, status: "needs_api_key" };
  if (seriesEnvNames.some((name) => !process.env[name])) return { ...item, status: "unavailable" };
  return item;
}

function unavailableOfficialProvider(countryCode: string, indicatorKey: IndicatorKey): ProviderChoice {
  const officialNames: Record<string, string> = {
    "CN-gdp_real": "China comparable real GDP level pending configuration",
    "TW-gdp_real": "Taiwan official GDP table",
    "TW-gdp_nominal": "Taiwan official GDP table",
    "TW-inflation_rate": "Taiwan official inflation table"
  };
  const key = `${countryCode}-${indicatorKey}`;

  return {
    key: "official_pending",
    name: officialNames[key] ?? "Official source pending configuration",
    status: "unavailable"
  };
}

export function unitForSeries(countryCode: string, indicatorKey: IndicatorKey) {
  if (indicatorKey === "cpi") return "YoY %";
  if (indicatorKey === "inflation_rate") return "%";
  if (indicatorKey === "policy_rate") return "%";
  if (indicatorKey === "lpr") return "%";

  const currency = currencyForCountry(countryCode);
  return countryCode === "US" ? `billion ${currency}, SAAR` : `billion ${currency}`;
}

function currencyForCountry(countryCode: string) {
  if (countryCode === "US") return "USD";
  if (countryCode === "EU") return "EUR";
  if (countryCode === "JP") return "JPY";
  if (countryCode === "KR") return "KRW";
  if (countryCode === "CN") return "CNY";
  if (countryCode === "TW") return "TWD";
  return "local currency";
}
