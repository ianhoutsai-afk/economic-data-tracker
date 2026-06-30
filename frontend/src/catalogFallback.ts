import type { Country, DataProvider, Indicator, Observation, ReleaseEvent, Series } from "./types";

export const countries: Country[] = [
  { code: "US", nameZh: "美國", nameEn: "United States", region: "north_america" },
  { code: "EU", nameZh: "歐元區 / ECB口徑", nameEn: "Euro Area / ECB Scope", region: "europe" },
  { code: "JP", nameZh: "日本", nameEn: "Japan", region: "east_asia" },
  { code: "KR", nameZh: "韓國", nameEn: "South Korea", region: "east_asia" },
  { code: "CN", nameZh: "中國", nameEn: "China", region: "china" },
  { code: "TW", nameZh: "台灣", nameEn: "Taiwan", region: "east_asia" }
];

export const indicators: Indicator[] = [
  { key: "gdp", nameZh: "GDP", nameEn: "GDP", unit: "series currency unit", frequency: "quarterly" },
  { key: "cpi", nameZh: "CPI", nameEn: "Consumer Price Index", unit: "YoY %", frequency: "monthly" },
  { key: "inflation_rate", nameZh: "通膨率", nameEn: "Inflation Rate", unit: "%", frequency: "monthly" },
  { key: "policy_rate", nameZh: "政策利率", nameEn: "Policy Rate", unit: "%", frequency: "event" },
  { key: "lpr", nameZh: "一年期 LPR", nameEn: "1-Year LPR", unit: "%", frequency: "event" }
];

export const dataProviders: DataProvider[] = [
  { key: "fred", name: "FRED", priority: 10, requiresApiKey: true, status: "needs_api_key", coverage: "US GDP and policy rate" },
  { key: "bls", name: "BLS Public Data API", priority: 20, requiresApiKey: false, status: "fresh", coverage: "US CPI monthly" },
  { key: "dbnomics", name: "DBnomics", priority: 25, requiresApiKey: false, status: "fresh", coverage: "Korea GDP and CPI via OECD/IMF mirror" },
  { key: "imf_datamapper", name: "IMF DataMapper API", priority: 24, requiresApiKey: false, status: "fresh", coverage: "East Asia and Taiwan GDP/CPI fallback" },
  { key: "taiwan_open_data", name: "Taiwan Government Open Data", priority: 26, requiresApiKey: false, status: "fresh", coverage: "Taiwan CPI open data" },
  { key: "eurostat", name: "Eurostat API", priority: 30, requiresApiKey: false, status: "fresh", coverage: "Euro area GDP and CPI" },
  { key: "ecb", name: "ECB Data Portal", priority: 35, requiresApiKey: false, status: "fresh", coverage: "Euro area policy rate" },
  { key: "bis", name: "BIS WS_CBPOL", priority: 40, requiresApiKey: false, status: "fresh", coverage: "Policy rate fallback" },
  {
    key: "estat",
    name: "Japan e-Stat API",
    priority: 42,
    requiresApiKey: true,
    status: "needs_api_key",
    registrationUrl: "https://www.e-stat.go.jp/api/api-dev/request",
    coverage: "Japan official API, free appId registration required"
  },
  {
    key: "china_nbs_dbnomics",
    name: "China NBS composite",
    priority: 45,
    requiresApiKey: false,
    status: "fresh",
    coverage: "China nominal GDP and CPI from NBS mirror with optional direct reads and IMF CPI gap filling"
  }
];

export const series: Series[] = countries.flatMap((country) =>
  indicators
    .filter((indicator) => {
      if (country.code === "CN" && indicator.key === "policy_rate") return false;
      if (indicator.key === "lpr" && country.code !== "CN") return false;
      return true;
    })
    .flatMap((indicator) => {
      // "gdp" indicator in the UI maps to both gdp_real and gdp_nominal backend series
      if (indicator.key === "gdp") {
        return (["gdp_real", "gdp_nominal"] as const).map((gdpKey) => ({
          id: `${country.code}-${gdpKey}`,
          countryCode: country.code,
          indicatorKey: gdpKey,
          source: sourceFor(country.code, gdpKey),
          unit: unitForSeries(country.code, gdpKey),
          status: country.code === "CN" && gdpKey === "gdp_real" ? "unavailable" : "real",
          sourceStatus: sourceStatusFor(country.code, gdpKey),
          providerKey: providerFor(country.code, gdpKey)
        }));
      }
      return {
        id: `${country.code}-${indicator.key}`,
        countryCode: country.code,
        indicatorKey: indicator.key,
        source: sourceFor(country.code, indicator.key),
        unit: unitForSeries(country.code, indicator.key),
        status: country.code === "CN" && indicator.key === "gdp_real" ? "unavailable" : "real",
        sourceStatus: sourceStatusFor(country.code, indicator.key),
        providerKey: providerFor(country.code, indicator.key)
      };
    })
);

export const observations: Observation[] = [];

export const releases: ReleaseEvent[] = [];

function sourceFor(countryCode: string, indicatorKey: Indicator["key"]) {
  if (indicatorKey === "gdp_real" || indicatorKey === "gdp_nominal") {
    if (countryCode === "US") return "FRED";
    if (countryCode === "EU") return "Eurostat API";
    if (countryCode === "KR") return "DBnomics OECD QNA";
    if (countryCode === "CN") return indicatorKey === "gdp_real" ? "China comparable real GDP level pending configuration" : "China NBS composite";
    return "IMF DataMapper API";
  }

  if (indicatorKey === "cpi" || indicatorKey === "inflation_rate") {
    if (countryCode === "US") return "BLS Public Data API";
    if (countryCode === "EU") return "Eurostat API";
    if (countryCode === "TW") return "Taiwan Government Open Data";
    if (countryCode === "KR") return "DBnomics IMF CPI";
    if (countryCode === "CN") return "China NBS composite";
    return "IMF DataMapper API";
  }

  if (indicatorKey === "policy_rate") {
    if (countryCode === "US") return "FRED";
    if (countryCode === "EU") return "ECB Data Portal";
    return "BIS WS_CBPOL";
  }

  // LPR: China only, from BIS WS_CBPOL
  if (indicatorKey === "lpr") return "BIS WS_CBPOL";

  return "unavailable";
}

function providerFor(countryCode: string, indicatorKey: Indicator["key"]) {
  if (indicatorKey === "gdp_real" || indicatorKey === "gdp_nominal") {
    if (countryCode === "US") return "fred";
    if (countryCode === "EU") return "eurostat";
    if (countryCode === "KR") return "dbnomics";
    if (countryCode === "CN") return indicatorKey === "gdp_real" ? "official_pending" : "china_nbs_dbnomics";
    return "imf_datamapper";
  }
  if (indicatorKey === "cpi" || indicatorKey === "inflation_rate") {
    if (countryCode === "US") return "bls";
    if (countryCode === "EU") return "eurostat";
    if (countryCode === "TW") return "taiwan_open_data";
    if (countryCode === "KR") return "dbnomics";
    if (countryCode === "CN") return "china_nbs_dbnomics";
    return "imf_datamapper";
  }
  // LPR: China only, via BIS WS_CBPOL
  if (indicatorKey === "lpr") return "bis";
  if (countryCode === "US") return "fred";
  if (countryCode === "EU") return "ecb";
  return "bis";
}

function sourceStatusFor(countryCode: string, indicatorKey: Indicator["key"]) {
  if (countryCode === "CN" && indicatorKey === "gdp_real") return "unavailable";
  const provider = providerFor(countryCode, indicatorKey);
  return provider === "fred" ? "needs_api_key" : "fresh";
}

function unitForSeries(countryCode: string, indicatorKey: Indicator["key"]) {
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
