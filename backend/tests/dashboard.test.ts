import { EventEmitter } from "node:events";
import httpMocks from "node-mocks-http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  process.env.DATABASE_URL = "";
  process.env.ENABLE_LIVE_PROVIDER_FALLBACK = "true";
  process.env.FRED_API_KEY = "test-key";

  return {
    fetchSeriesData: vi.fn()
  };
});

vi.mock("../src/services/providers.js", () => ({
  fetchSeriesData: mocks.fetchSeriesData,
  isProviderConfigured: (series: { providerKey?: string }) => (series.providerKey === "fred" ? Boolean(process.env.FRED_API_KEY) : true)
}));

const { default: app } = await import("../src/app.js");

describe("dashboard API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchSeriesData.mockResolvedValue({
      observations: [{ date: "2025-03-31", period: "2025-Q1", frequency: "quarterly", value: 101.2, source: "FRED" }],
      releases: [{ eventType: "gdp_release", date: "2025-03-31", period: "2025-Q1", actual: 101.2, source: "FRED" }],
      sourceStatus: "fresh",
      comparisonWarnings: [{ period: "2025-Q1", primarySource: "FRED", comparisonSource: "mirror", primaryValue: 101.2, comparisonValue: 101, difference: 0.2 }]
    });
  });

  it("returns a single dashboard payload with live fallback observations", async () => {
    const response = await dispatch("GET", "/api/v1/dashboard?indicatorKey=gdp_real&range=5y&viewFrequency=quarterly&region=north_america");

    expect(response.statusCode).toBe(200);
    expect(response.body.data.countries[0]).toMatchObject({ code: "US" });
    expect(response.body.data.series).toHaveLength(1);
    expect(response.body.data.series[0]).toMatchObject({ unit: "billion USD, SAAR" });
    expect(response.body.data.observations).toHaveLength(1);
    expect(response.body.data.observations[0]).toMatchObject({ unit: "billion USD, SAAR" });
    expect(response.body.data.releases).toHaveLength(1);
    expect(response.body.data.providers.map((item: { key: string }) => item.key)).toContain("fred");
    expect(response.body.data.dataQualityWarnings[0]).toMatchObject({ seriesId: "US-gdp_real", period: "2025-Q1" });
  });

  it("limits the European dashboard region to the ECB euro-area series", async () => {
    const response = await dispatch("GET", "/api/v1/dashboard?indicatorKey=gdp_real&range=5y&viewFrequency=quarterly&region=europe");

    expect(response.statusCode).toBe(200);
    expect(response.body.data.series).toHaveLength(1);
    expect(response.body.data.series[0]).toMatchObject({ id: "EU-gdp_real", countryCode: "EU" });
    expect(response.body.data.series.map((item: { countryCode: string }) => item.countryCode)).not.toContain("DE");
    expect(response.body.data.series.map((item: { countryCode: string }) => item.countryCode)).not.toContain("FR");
  });
});

async function dispatch(method: "GET", url: string) {
  const request = httpMocks.createRequest({ method, url });
  const response = httpMocks.createResponse({ eventEmitter: EventEmitter });

  await new Promise<void>((resolve) => {
    response.on("end", resolve);
    app.handle(request, response);
  });

  return {
    statusCode: response.statusCode,
    body: response._getJSONData()
  };
}
