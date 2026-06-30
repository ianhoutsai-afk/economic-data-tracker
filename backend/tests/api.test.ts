import { EventEmitter } from "node:events";
import httpMocks from "node-mocks-http";
import { describe, expect, it, vi } from "vitest";
import app from "../src/app.js";

vi.hoisted(() => {
  process.env.DATABASE_URL = "";
  process.env.ENABLE_LIVE_PROVIDER_FALLBACK = "false";
});

describe("economic data API", () => {
  it("returns a health envelope", async () => {
    const response = await dispatch("GET", "/api/health");

    expect(response.statusCode).toBe(200);
    expect(response.body.data.status).toBe("ok");
    expect(response.body.data.service).toBe("economic-data-tracker-api");
  });

  it("returns countries, indicators, and series as JSON envelopes without synthetic observations", async () => {
    const countries = await dispatch("GET", "/api/v1/countries");
    const indicators = await dispatch("GET", "/api/v1/indicators");
    const series = await dispatch("GET", "/api/v1/series?countryCode=US");
    const chinaSeries = await dispatch("GET", "/api/v1/series?countryCode=CN");
    const germanySeries = await dispatch("GET", "/api/v1/series?countryCode=DE");
    const franceSeries = await dispatch("GET", "/api/v1/series?countryCode=FR");
    const observations = await dispatch("GET", "/api/v1/observations?indicatorKey=gdp_real");
    const countryCodes = countries.body.data.map((item: { code: string }) => item.code);

    expect(countries.body.data[0]).toMatchObject({ code: "US", nameZh: "美國" });
    expect(countryCodes).toContain("EU");
    expect(countryCodes).not.toContain("DE");
    expect(countryCodes).not.toContain("FR");
    expect(indicators.body.data.map((item: { key: string }) => item.key)).toContain("gdp_real");
    expect(series.body.data.every((item: { countryCode: string }) => item.countryCode === "US")).toBe(true);
    expect(chinaSeries.body.data.find((item: { id: string }) => item.id === "CN-gdp_real")).toMatchObject({
      status: "unavailable",
      sourceStatus: "unavailable"
    });
    expect(chinaSeries.body.data.map((item: { id: string }) => item.id)).not.toContain("CN-policy_rate");
    expect(germanySeries.body.data).toEqual([]);
    expect(franceSeries.body.data).toEqual([]);
    expect(observations.body.data).toEqual([]);
  });

  it("returns empty observation lists before real data is synced", async () => {
    const oneYear = await dispatch("GET", "/api/v1/observations?indicatorKey=gdp_real&range=1y");
    const all = await dispatch("GET", "/api/v1/observations?indicatorKey=gdp_real&range=all");

    expect(oneYear.body.data).toEqual([]);
    expect(all.body.data).toEqual([]);
  });

  it("returns quarterly observation views, releases, and provider metadata", async () => {
    const quarterly = await dispatch("GET", "/api/v1/observations?indicatorKey=cpi&range=1y&viewFrequency=quarterly");
    const releases = await dispatch("GET", "/api/v1/releases?indicatorKey=cpi&range=1y");
    const providers = await dispatch("GET", "/api/v1/providers");

    expect(quarterly.body.data.every((item: { frequency: string }) => item.frequency === "quarterly")).toBe(true);
    expect(releases.body.data).toEqual([]);
    expect(providers.body.data.map((item: { key: string }) => item.key)).toContain("imf_datamapper");
    expect(providers.body.data.map((item: { key: string }) => item.key)).toContain("taiwan_open_data");
    expect(providers.body.data.map((item: { key: string }) => item.key)).toContain("dbnomics");
    expect(providers.body.data.map((item: { key: string }) => item.key)).not.toContain("kosis");
    expect(providers.body.data.map((item: { key: string }) => item.key)).not.toContain("ecos");
  });

  it("uses the standard error shape for missing routes", async () => {
    const response = await dispatch("GET", "/api/unknown");

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "not_found",
        message: "Route not found"
      }
    });
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
