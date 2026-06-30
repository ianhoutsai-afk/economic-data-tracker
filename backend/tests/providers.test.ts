import { afterEach, describe, expect, it, vi } from "vitest";
import { clearProviderCache, fetchSeriesData } from "../src/services/providers.js";
import type { Series } from "../src/types.js";

describe("data providers", () => {
  afterEach(() => {
    clearProviderCache();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("marks keyed providers as missing configuration when no key is set", async () => {
    vi.stubEnv("FRED_API_KEY", "");

    await expect(fetchSeriesData({ ...baseSeries, providerKey: "fred", sourceStatus: "pending" })).rejects.toThrow("FRED API key is required");
  });

  it("converts BLS monthly CPI data into observations and release events", async () => {
    vi.stubEnv("FRED_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          Results: {
            series: [
              {
                data: [
                  { year: "2025", period: "M02", value: "206.2" },
                  { year: "2025", period: "M01", value: "103.0" },
                  { year: "2024", period: "M02", value: "200.0" },
                  { year: "2024", period: "M01", value: "100.0" }
                ]
              }
            ]
          }
        })
      })
    );

    const result = await fetchSeriesData({
      id: "US-cpi",
      countryCode: "US",
      indicatorKey: "cpi",
      source: "BLS Public Data API",
      providerKey: "bls",
      status: "real",
      sourceStatus: "pending"
    });

    expect(result.sourceStatus).toBe("fresh");
    expect(result.observations.map((item) => item.period)).toEqual(["2025-01", "2025-02"]);
    expect(result.observations.map((item) => item.value)).toEqual([3, 3.1]);
    expect(result.observations.map((item) => item.rawValue)).toEqual([103, 206.2]);
    expect(result.releases[0]).toMatchObject({ eventType: "cpi_release", source: "BLS Public Data API" });
  });

  it("keeps provider policy rates in percentage-point units and compresses unchanged daily rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "TIME_PERIOD,OBS_VALUE\n2025-01-01,0.05\n2025-01-02,0.05\n2025-01-03,0.10\n2025-01-04,0.10"
      })
    );

    const result = await fetchSeriesData({
      id: "KR-policy_rate",
      countryCode: "KR",
      indicatorKey: "policy_rate",
      source: "BIS WS_CBPOL",
      providerKey: "bis",
      status: "real",
      sourceStatus: "pending"
    }, { mode: "history", lookbackYears: 5, now: new Date("2026-01-01T00:00:00.000Z") });

    expect(result.observations).toHaveLength(3);
    expect(result.releases).toHaveLength(2);
    expect(result.observations[0]).toMatchObject({
      value: 0.05,
      rawValue: 0.05,
      normalizedValue: 0.05
    });
    expect(result.observations.at(-1)).toMatchObject({ date: "2025-01-04", value: 0.1 });
  });

  it("reuses cached provider responses for repeated series requests", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        observations: [
          { date: "2025-01-01", value: "100" },
          { date: "2025-04-01", value: "101" }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchSeriesData({ ...baseSeries, providerKey: "fred", sourceStatus: "pending" }, { mode: "history", lookbackYears: 5 });
    await fetchSeriesData({ ...baseSeries, providerKey: "fred", sourceStatus: "pending" }, { mode: "history", lookbackYears: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps the nominal GDP indicator to FRED nominal GDP series", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        observations: [{ date: "2026-01-01", value: "31856.257" }]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeriesData(
      { ...baseSeries, indicatorKey: "gdp_nominal", id: "US-gdp_nominal", sourceStatus: "pending", providerKey: "fred" },
      { mode: "history", lookbackYears: 1 }
    );
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(requestUrl.searchParams.get("series_id")).toBe("GDP");
    expect(result.observations[0]).toMatchObject({
      period: "2026-Q1",
      value: 31856.257,
      source: "FRED"
    });
  });

  it("maps the real GDP indicator to FRED real GDP series (GDPC1)", async () => {
    vi.stubEnv("FRED_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        observations: [{ date: "2026-01-01", value: "22000.5" }]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeriesData(
      { ...baseSeries, indicatorKey: "gdp_real", id: "US-gdp_real", sourceStatus: "pending", providerKey: "fred" },
      { mode: "history", lookbackYears: 1 }
    );
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(requestUrl.searchParams.get("series_id")).toBe("GDPC1");
    expect(result.observations[0]).toMatchObject({
      period: "2026-Q1",
      value: 22000.5,
      source: "FRED"
    });
  });

  it("fetches Japan real GDP from the Statistics Dashboard indicator code", async () => {
    vi.stubEnv("ESTAT_APP_ID", "test-app");
    vi.stubEnv("ESTAT_GDP_STATS_DATA_ID", "0705020501000010000");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          GET_STATS: {
            RESULT: { status: "0" },
            STATISTICAL_DATA: {
              DATA_INF: {
                DATA_OBJ: [
                  {
                    VALUE: {
                      "@time": "20251Q00",
                      "@cycle": "2",
                      "@regionCode": "00000",
                      "@regionRank": "2",
                      "@isSeasonal": "1",
                      "$": "150000.0"
                    }
                  },
                  {
                    VALUE: {
                      "@time": "20251Q00",
                      "@cycle": "2",
                      "@regionCode": "00000",
                      "@regionRank": "2",
                      "@isSeasonal": "2",
                      "$": "560000.5"
                    }
                  }
                ]
              }
            }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{}, []]
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeriesData(
      {
        id: "JP-gdp_real",
        countryCode: "JP",
        indicatorKey: "gdp_real",
        source: "Japan e-Stat API",
        providerKey: "estat",
        status: "real",
        sourceStatus: "pending"
      },
      { mode: "history", lookbackYears: 5, now: new Date("2026-01-01T00:00:00.000Z") }
    );
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(requestUrl.hostname).toBe("dashboard.e-stat.go.jp");
    expect(requestUrl.searchParams.get("IndicatorCode")).toBe("0705020501000010000");
    expect(result.sourceStatus).toBe("fresh");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      date: "2025-03-31",
      period: "2025-Q1",
      value: 560000.5,
      source: "Japan e-Stat Dashboard"
    });
  });

  it("fetches Japan CPI monthly YoY data from the Statistics Dashboard indicator code", async () => {
    vi.stubEnv("ESTAT_APP_ID", "test-app");
    vi.stubEnv("ESTAT_CPI_STATS_DATA_ID", "0703010501010030000");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          GET_STATS: {
            RESULT: { status: "0" },
            STATISTICAL_DATA: {
              DATA_INF: {
                DATA_OBJ: [
                  {
                    VALUE: {
                      "@time": "20250400",
                      "@cycle": "2",
                      "@regionCode": "00000",
                      "@regionRank": "2",
                      "@isSeasonal": "1",
                      "$": "9.9"
                    }
                  },
                  {
                    VALUE: {
                      "@time": "20250400",
                      "@cycle": "1",
                      "@regionCode": "00000",
                      "@regionRank": "2",
                      "@isSeasonal": "2",
                      "$": "8.8"
                    }
                  },
                  {
                    VALUE: {
                      "@time": "20250400",
                      "@cycle": "1",
                      "@regionCode": "00000",
                      "@regionRank": "2",
                      "@isSeasonal": "1",
                      "@isProvisional": "1",
                      "$": "3.6"
                    }
                  }
                ]
              }
            }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {},
          [
            { date: "2025", value: "103.6" },
            { date: "2024", value: "100" }
          ]
        ]
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeriesData(
      {
        id: "JP-cpi",
        countryCode: "JP",
        indicatorKey: "cpi",
        source: "Japan e-Stat API",
        providerKey: "estat",
        status: "real",
        sourceStatus: "pending"
      },
      { mode: "history", lookbackYears: 5, now: new Date("2026-01-01T00:00:00.000Z") }
    );
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(requestUrl.hostname).toBe("dashboard.e-stat.go.jp");
    expect(requestUrl.searchParams.get("IndicatorCode")).toBe("0703010501010030000");
    expect(result.sourceStatus).toBe("fresh");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      date: "2025-04-01",
      period: "2025-04",
      frequency: "monthly",
      value: 3.6,
      revisionTag: "provisional",
      unit: "YoY %",
      source: "Japan e-Stat Dashboard"
    });
  });

  it("uses the Japan CPI indicator code for inflation-rate monthly observations", async () => {
    vi.stubEnv("ESTAT_APP_ID", "test-app");
    vi.stubEnv("ESTAT_CPI_STATS_DATA_ID", "0703010501010030000");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          GET_STATS: {
            RESULT: { status: "0" },
            STATISTICAL_DATA: {
              DATA_INF: {
                DATA_OBJ: {
                  VALUE: {
                    "@time": "19710100",
                    "@cycle": "1",
                    "@regionCode": "00000",
                    "@regionRank": "2",
                    "@isSeasonal": "1",
                    "$": "6.5"
                  }
                }
              }
            }
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{}, [{ date: "1971", value: "6.5" }]]
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeriesData(
      {
        id: "JP-inflation_rate",
        countryCode: "JP",
        indicatorKey: "inflation_rate",
        source: "Japan e-Stat API",
        providerKey: "estat",
        status: "real",
        sourceStatus: "pending"
      },
      { mode: "history", lookbackYears: 60, now: new Date("2026-01-01T00:00:00.000Z") }
    );

    expect(result.observations[0]).toMatchObject({
      date: "1971-01-01",
      period: "1971-01",
      frequency: "monthly",
      value: 6.5,
      unit: "%",
      source: "Japan e-Stat Dashboard"
    });
  });

  it("fetches Korea real GDP from DBnomics OECD quarterly national accounts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          series: {
            docs: [
              {
                period: ["2024-Q4", "2025-Q1"],
                value: [500000000, 503433700]
              }
            ]
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{}, []]
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeriesData(
      {
        id: "KR-gdp_real",
        countryCode: "KR",
        indicatorKey: "gdp_real",
        source: "DBnomics",
        providerKey: "dbnomics",
        status: "real",
        sourceStatus: "pending"
      },
      { mode: "history", lookbackYears: 5, now: new Date("2026-01-01T00:00:00.000Z") }
    );
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(requestUrl.pathname).toBe("/v22/series/OECD/QNA/KOR.B1_GE.LNBQRSA.Q");
    expect(result.sourceStatus).toBe("fresh");
    expect(result.observations.at(-1)).toMatchObject({
      date: "2025-03-31",
      period: "2025-Q1",
      frequency: "quarterly",
      value: 503433.7,
      rawValue: 503433700,
      unit: "billion KRW",
      source: "DBnomics OECD QNA"
    });
  });

  it("fetches Korea CPI from DBnomics IMF monthly CPI and converts it to YoY", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          series: {
            docs: [
              {
                period: ["2024-01-01", "2025-01-01", "2025-02-01"],
                value: [100, 105, 106]
              }
            ]
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{}, []]
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeriesData(
      {
        id: "KR-cpi",
        countryCode: "KR",
        indicatorKey: "cpi",
        source: "DBnomics",
        providerKey: "dbnomics",
        status: "real",
        sourceStatus: "pending"
      },
      { mode: "history", lookbackYears: 5, now: new Date("2026-01-01T00:00:00.000Z") }
    );
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));

    expect(requestUrl.pathname).toBe("/v22/series/IMF/CPI/M.KR.PCPI_IX");
    expect(result.sourceStatus).toBe("fresh");
    expect(result.observations).toEqual([
      expect.objectContaining({
        date: "2025-01-01",
        period: "2025-01",
        frequency: "monthly",
        value: 5,
        rawValue: 105,
        unit: "YoY %",
        source: "DBnomics IMF CPI"
      })
    ]);
  });

  it("normalizes China nominal GDP from 100 million yuan into billion CNY while direct reads are disabled", async () => {
    vi.stubEnv("NBS_DIRECT_ENABLED", "false");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/v22/series/NBS/Q_A0101/A010101")) {
        return jsonResponse({
          series: {
            docs: [{ period: ["2025-Q1"], value: [341443.2] }]
          }
        });
      }
      if (url.includes("api.worldbank.org")) return jsonResponse([{}, []]);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeriesData(chinaSeries("gdp_nominal"), {
      mode: "history",
      lookbackYears: 1,
      now: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("data.stats.gov.cn"))).toBe(false);
    expect(result.observations[0]).toMatchObject({
      period: "2025-Q1",
      value: 34144.32,
      rawValue: 341443.2,
      unit: "billion CNY",
      source: "DBnomics China NBS GDP"
    });
  });

  it("merges China CPI classification windows and fills NBS gaps with IMF CPI", async () => {
    vi.stubEnv("NBS_DIRECT_ENABLED", "false");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/v22/series/NBS/M_A01010G/A01010G01")) {
        return jsonResponse({ series: { docs: [{ period: ["2025-12"], value: [100.8] }] } });
      }
      if (url.includes("/v22/series/NBS/M_A01010J/A01010J01")) {
        return jsonResponse({ series: { docs: [{ period: ["2026-01", "2026-02"], value: [100.2, "NA"] }] } });
      }
      if (url.includes("/v22/series/IMF/CPI/M.CN.PCPI_IX")) {
        return jsonResponse({
          series: {
            docs: [{
              period: ["2024-12", "2025-01", "2025-02", "2025-12", "2026-01", "2026-02"],
              value: [100, 100, 100, 101, 102, 103]
            }]
          }
        });
      }
      if (url.includes("api.worldbank.org")) return jsonResponse([{}, []]);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeriesData(chinaSeries("cpi"), {
      mode: "history",
      lookbackYears: 1,
      now: new Date("2026-02-20T00:00:00.000Z")
    });

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      expect.stringContaining("/v22/series/NBS/M_A01010G/A01010G01"),
      expect.stringContaining("/v22/series/NBS/M_A01010J/A01010J01")
    ]));
    expect(result.sourceStatus).toBe("fresh");
    expect(result.observations).toEqual([
      expect.objectContaining({ period: "2025-12", value: 0.8, source: "DBnomics China NBS CPI" }),
      expect.objectContaining({ period: "2026-01", value: 0.2, source: "DBnomics China NBS CPI" }),
      expect.objectContaining({ period: "2026-02", value: 3, source: "DBnomics IMF CPI fallback" })
    ]);
    expect(result.comparisonWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        period: "2026-01",
        primarySource: "DBnomics China NBS CPI",
        comparisonSource: "DBnomics IMF CPI fallback"
      })
    ]));
  });

  it("marks China CPI as stale when only the IMF fallback has usable observations", async () => {
    vi.stubEnv("NBS_DIRECT_ENABLED", "false");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/v22/series/NBS/M_A01010G/A01010G01")) {
        return jsonResponse({ series: { docs: [{ period: ["2025-01"], value: ["NA"] }] } });
      }
      if (url.includes("/v22/series/IMF/CPI/M.CN.PCPI_IX")) {
        return jsonResponse({ series: { docs: [{ period: ["2024-01", "2025-01"], value: [100, 101] }] } });
      }
      if (url.includes("api.worldbank.org")) return jsonResponse([{}, []]);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeriesData(chinaSeries("cpi"), {
      mode: "history",
      lookbackYears: 1,
      now: new Date("2025-02-20T00:00:00.000Z")
    });

    expect(result.sourceStatus).toBe("stale");
    expect(result.observations).toEqual([
      expect.objectContaining({ period: "2025-01", value: 1, source: "DBnomics IMF CPI fallback" })
    ]);
  });

  it("prefers China NBS direct observations when EasyQuery is enabled", async () => {
    vi.stubEnv("NBS_DIRECT_ENABLED", "true");
    vi.stubEnv("NBS_DIRECT_TIMEOUT_MS", "50");
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("data.stats.gov.cn")) {
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain("A010101");
        expect(init?.signal).toBeDefined();
        return jsonResponse({
          returncode: 200,
          returndata: {
            datanodes: [{
              data: { hasdata: true, strdata: "350000" },
              wds: [{ wdcode: "zb", valuecode: "A010101" }, { wdcode: "sj", valuecode: "2025A" }]
            }]
          }
        });
      }
      if (url.includes("/v22/series/NBS/Q_A0101/A010101")) {
        return jsonResponse({ series: { docs: [{ period: ["2025-Q1"], value: [341443.2] }] } });
      }
      if (url.includes("api.worldbank.org")) return jsonResponse([{}, []]);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeriesData(chinaSeries("gdp_nominal"), {
      mode: "history",
      lookbackYears: 1,
      now: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(result.observations[0]).toMatchObject({
      period: "2025-Q1",
      value: 35000,
      source: "China NBS Direct"
    });
  });

  it("falls back to the China NBS mirror when EasyQuery direct reads fail", async () => {
    vi.stubEnv("NBS_DIRECT_ENABLED", "true");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("data.stats.gov.cn")) throw new Error("direct timeout");
      if (url.includes("/v22/series/NBS/Q_A0101/A010101")) {
        return jsonResponse({ series: { docs: [{ period: ["2025-Q1"], value: [341443.2] }] } });
      }
      if (url.includes("api.worldbank.org")) return jsonResponse([{}, []]);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSeriesData(chinaSeries("gdp_nominal"), {
      mode: "history",
      lookbackYears: 1,
      now: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(result.sourceStatus).toBe("fresh");
    expect(result.observations[0]).toMatchObject({
      value: 34144.32,
      source: "DBnomics China NBS GDP"
    });
  });

  it("normalizes Eurostat GDP from millions into billions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          value: [4127433.1],
          dimension: {
            time: {
              category: {
                index: {
                  "2025-Q4": 0
                }
              }
            }
          }
        })
      })
    );

    const result = await fetchSeriesData({
      id: "EU-gdp_real",
      countryCode: "EU",
      indicatorKey: "gdp_real",
      source: "Eurostat API",
      providerKey: "eurostat",
      status: "real",
      sourceStatus: "pending"
    });

    expect(result.observations[0]).toMatchObject({
      period: "2025-Q4",
      value: 4127.4331,
      rawValue: 4127433.1,
      source: "Eurostat API"
    });
  });

  it("uses World Bank CPI only as calibration and normalizes annual index values to YoY warnings", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            value: [2.5],
            dimension: {
              time: {
                category: {
                  index: {
                    "2025-01": 0
                  }
                }
              }
            }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {},
            [
              { date: "2025", value: "105" },
              { date: "2024", value: "100" }
            ]
          ]
        })
    );

    const result = await fetchSeriesData(
      {
        id: "EU-cpi",
        countryCode: "EU",
        indicatorKey: "cpi",
        source: "Eurostat API",
        providerKey: "eurostat",
        status: "real",
        sourceStatus: "pending"
      },
      { mode: "history", lookbackYears: 5, now: new Date("2026-01-01T00:00:00.000Z") }
    );

    expect(result.observations[0]).toMatchObject({ source: "Eurostat API", value: 2.5 });
    expect(result.observations.some((item) => item.source.includes("World Bank"))).toBe(false);
    expect(result.comparisonWarnings?.[0]).toMatchObject({
      primarySource: "Eurostat API",
      comparisonSource: "World Bank API (FP.CPI.TOTL)",
      comparisonValue: 5
    });
  });
});

const baseSeries: Series = {
  id: "US-gdp_real",
  countryCode: "US",
  indicatorKey: "gdp_real",
  source: "FRED",
  status: "real"
};

function chinaSeries(indicatorKey: "gdp_nominal" | "cpi" | "inflation_rate"): Series {
  return {
    id: `CN-${indicatorKey}`,
    countryCode: "CN",
    indicatorKey,
    source: "China NBS composite",
    providerKey: "china_nbs_dbnomics",
    status: "real",
    sourceStatus: "pending"
  };
}

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload
  };
}
