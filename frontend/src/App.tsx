import { CalendarDays, Database, Info, KeyRound, LineChart, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { dataMode, economicApi, fallbackData } from "./apiClient";
import type { Country, DashboardPayload, Indicator, Observation, ObservationRange, ReleaseEvent, Series, ViewFrequency } from "./types";

type DashboardData = DashboardPayload;
type GdpChartMode = "real" | "nominal" | "indexed";
type SeriesRow = Series & {
  country: Country | undefined;
  indicator: Indicator | undefined;
  points: Observation[];
  latestValue: number;
  latestDate: string;
  displayUnit?: string;
  change: number;
  displayName: string;
};

const GDP_BASE_YEAR = "2020";
const gdpIndicatorKeys: Array<Extract<Indicator["key"], "gdp_real" | "gdp_nominal">> = ["gdp_real", "gdp_nominal"];

const regionLabels: Record<Country["region"], string> = {
  north_america: "北美",
  europe: "歐元區",
  east_asia: "東亞",
  china: "中國"
};

const indicatorDefinitions: Record<Indicator["key"], { title: string; lines: string[] }> = {
  gdp: {
    title: "GDP 定義",
    lines: [
      "國內生產毛額（GDP）衡量一個經濟體在特定時期內生產的最終商品與服務的市場價值。",
      "實質 GDP 經通膨調整，反映實際產出成長；名目 GDP 按當期價格計算。",
      "支出法公式：GDP = C + I + G + (X - M)。"
    ]
  },
  gdp_real: {
    title: "實質 GDP 定義",
    lines: [
      "實質 GDP 是經通膨調整後的國內生產毛額，反映經濟體的實際產出成長。",
      "實質 GDP = 名目 GDP / GDP 平減指數 × 100。",
      "支出法公式：GDP = C + I + G + (X - M)，以基期價格計算。"
    ]
  },
  gdp_nominal: {
    title: "名目 GDP 定義",
    lines: [
      "名目 GDP 按當期價格計算的國內生產毛額，未經通膨調整。",
      "名目 GDP 變動反映產出數量變化與價格水準變化的綜合效果。",
      "支出法公式：GDP = C + I + G + (X - M)，以當期價格計算。"
    ]
  },
  cpi: {
    title: "CPI 定義",
    lines: [
      "消費者物價指數衡量家庭購買一籃子商品與服務的價格水準變化。",
      "CPI =（當期一籃子商品與服務成本 / 基期同一籃子成本）× 100。",
      "通膨率 =（本期 CPI - 上期 CPI）/ 上期 CPI × 100%。"
    ]
  },
  inflation_rate: {
    title: "通膨率定義",
    lines: [
      "通膨率衡量經濟體中商品與服務價格水準隨時間的上漲幅度。",
      "最常見的計算方式：通膨率 = (CPI 本期 - CPI 去年同期) / CPI 去年同期 × 100%。",
      "溫和的通膨反映經濟成長，過高通膨則侵蝕購買力。"
    ]
  },
  policy_rate: {
    title: "政策利率概念",
    lines: [
      "政策利率是央行用來傳導貨幣政策的關鍵短期利率或操作目標。",
      "它會影響銀行資金成本、貸款利率、存款利率與整體金融條件。",
      "歐洲板塊採 ECB / 歐元區投資口徑，並搭配 Eurostat 歐元區資料。"
    ]
  },
  lpr: {
    title: "一年期 LPR（貸款市場報價利率）",
    lines: [
      "LPR 由 18 家報價行在 MLF 利率基礎上加點形成，每月 20 日發布。",
      "目前的 LPR 機制自 2019 年 8 月起實施，取代了舊的貸款基準利率。",
      "LPR 與傳統的政策利率定義不同，屬中國獨有的貸款市場基準利率。"
    ]
  }
};

export default function App() {
  const [data, setData] = useState<DashboardData>(fallbackData);
  const [selectedIndicator, setSelectedIndicator] = useState<Indicator["key"]>("gdp");
  const [selectedRegion, setSelectedRegion] = useState<Country["region"]>("north_america");
  const [selectedRange, setSelectedRange] = useState<ObservationRange>("5y");
  const [selectedViewFrequency, setSelectedViewFrequency] = useState<ViewFrequency>("quarterly");
  const [gdpChartMode, setGdpChartMode] = useState<GdpChartMode>("real");
  const [isFallback, setIsFallback] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const isGdpIndicator = isGdpIndicatorKey(selectedIndicator);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const baseRequest = {
      range: isGdpIndicator && gdpChartMode === "indexed" ? "all" : selectedRange,
      region: selectedRegion,
      viewFrequency: selectedViewFrequency,
      forceRefresh: refreshNonce > 0
    };
    const request = isGdpIndicator
      ? Promise.all(
          gdpIndicatorKeys.map((indicatorKey) =>
            economicApi.getDashboard({
              ...baseRequest,
              indicatorKey
            })
          )
        ).then((payloads) => mergeDashboardPayloads(...payloads))
      : economicApi.getDashboard({
          ...baseRequest,
          indicatorKey: selectedIndicator
        });

    request
      .then((dashboard) => {
        if (!isMounted) return;
        setData(dashboard);
        setIsFallback(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setData({
          ...fallbackData,
          observations: applyLocalViewFrequency(filterByRange(fallbackData.observations, selectedRange), selectedViewFrequency),
          releases: filterReleasesByRange(fallbackData.releases, selectedRange),
          dataQualityWarnings: []
        });
        setIsFallback(true);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [gdpChartMode, isGdpIndicator, selectedIndicator, selectedRange, selectedRegion, selectedViewFrequency, refreshNonce]);

  const visibleCountries = useMemo(() => {
    return data.countries.filter((country) => country.region === selectedRegion);
  }, [data.countries, selectedRegion]);

  const indicator = data.indicators.find((item) => item.key === selectedIndicator) ?? data.indicators[0];
  const selectedTrendIndicator: Indicator["key"] = isGdpIndicator
    ? gdpChartMode === "nominal"
      ? "gdp_nominal"
      : "gdp_real"
    : selectedIndicator;
  const trendIndicatorKeys: Indicator["key"][] = isGdpIndicator && gdpChartMode === "indexed" ? [...gdpIndicatorKeys] : [selectedTrendIndicator];
  const visibleSeriesForIndicator = useMemo(() => {
    const countryCodes = new Set(visibleCountries.map((country) => country.code));
    const matchingKeys = new Set<Indicator["key"]>(isGdpIndicator ? gdpIndicatorKeys : [selectedIndicator]);
    return data.series.filter((item) => matchingKeys.has(item.indicatorKey) && countryCodes.has(item.countryCode));
  }, [data.series, isGdpIndicator, selectedIndicator, visibleCountries]);
  const visibleSeriesForTrend = useMemo(() => {
    const countryCodes = new Set(visibleCountries.map((country) => country.code));
    const indicatorKeys = new Set<Indicator["key"]>(trendIndicatorKeys);
    return data.series.filter((item) => indicatorKeys.has(item.indicatorKey) && countryCodes.has(item.countryCode));
  }, [data.series, trendIndicatorKeys, visibleCountries]);
  const visibleSeriesForSnapshot = useMemo(() => {
    const countryCodes = new Set(visibleCountries.map((country) => country.code));
    const indicatorKeys = new Set<Indicator["key"]>(isGdpIndicator ? gdpIndicatorKeys : [selectedIndicator]);
    return data.series.filter((item) => indicatorKeys.has(item.indicatorKey) && countryCodes.has(item.countryCode));
  }, [data.series, isGdpIndicator, selectedIndicator, visibleCountries]);

  const chartRows = useMemo(() => {
    return buildSeriesRows(visibleSeriesForIndicator, data.observations, data.countries, data.indicators);
  }, [data.countries, data.indicators, data.observations, visibleSeriesForIndicator]);
  const trendRows = useMemo(() => {
    return buildSeriesRows(visibleSeriesForTrend, data.observations, data.countries, data.indicators);
  }, [data.countries, data.indicators, data.observations, visibleSeriesForTrend]);
  const snapshotRows = useMemo(() => {
    return buildSeriesRows(visibleSeriesForSnapshot, data.observations, data.countries, data.indicators);
  }, [data.countries, data.indicators, data.observations, visibleSeriesForSnapshot]);

  const usesIndexedChart = isGdpIndicator && gdpChartMode === "indexed";
  const comparisonRows = useMemo(() => {
    const displayRows = trendRows.map((row) => ({
      ...row,
      points: filterByRange(row.points, selectedRange)
    }));
    const dates = Array.from(new Set(displayRows.flatMap((row) => row.points.map((point) => point.date)))).sort();
    const baseBySeriesId = new Map(trendRows.map((row) => [row.id, baseValueForYear(row.points, GDP_BASE_YEAR)]));

    return dates.map((date) => {
      const row: Record<string, string | number | undefined> = { date };
      displayRows.forEach((seriesRow) => {
        const point = seriesRow.points.find((item) => item.date === date);
        if (point && seriesRow.country) {
          const baseValue = baseBySeriesId.get(seriesRow.id);
          if (usesIndexedChart && !baseValue) return;
          const chartValue = usesIndexedChart && baseValue ? (point.value / baseValue) * 100 : point.value;
          row[seriesRow.displayName] = Number(chartValue.toFixed(4));
          row[`${seriesRow.displayName}__raw`] = point.value;
          row[`${seriesRow.displayName}__unit`] = seriesRow.displayUnit;
          row[`${seriesRow.displayName}__indicatorKey`] = seriesRow.indicatorKey;
        }
      });
      return row;
    });
  }, [selectedRange, trendRows, usesIndexedChart]);

  const missingBaseYearSeries = useMemo(() => {
    if (!usesIndexedChart) return [];
    return trendRows.filter((row) => !baseValueForYear(row.points, GDP_BASE_YEAR)).map((row) => row.displayName);
  }, [trendRows, usesIndexedChart]);

  const missingChartSeries = useMemo(() => {
    const plottedSeriesIds = new Set(chartRows.map((row) => row.id));
    const countryByCode = new Map(data.countries.map((country) => [country.code, country.nameZh]));

    return visibleSeriesForIndicator
      .filter((series) => !plottedSeriesIds.has(series.id))
      .map((series) => {
        const reason =
          series.sourceStatus === "needs_api_key"
            ? "需要官方 API key"
            : series.status === "unavailable" || series.sourceStatus === "unavailable"
              ? "官方來源尚未配置"
              : "目前區間無觀測值";
        return `${countryByCode.get(series.countryCode) ?? series.countryCode}：${reason}`;
      });
  }, [chartRows, data.countries, visibleSeriesForIndicator]);

  const marketPulse = snapshotRows
    .slice()
    .sort((a, b) => b.latestValue - a.latestValue)
    .slice(0, 4);

  const unavailableCount = data.series.filter((row) => row.status === "unavailable" || row.sourceStatus === "failed").length;
  const needsKeyCount = data.series.filter((row) => row.sourceStatus === "needs_api_key").length;
  const selectedUnavailableCount = visibleSeriesForIndicator.filter((row) => row.status === "unavailable" || row.sourceStatus === "unavailable").length;
  const selectedNeedsKeyCount = visibleSeriesForIndicator.filter((row) => row.sourceStatus === "needs_api_key").length;
  const providerSummary = {
    official: visibleSeriesForIndicator.filter((row) => row.status !== "unavailable" && row.sourceStatus !== "needs_api_key").length,
    pending: selectedUnavailableCount + selectedNeedsKeyCount,
    calibration: data.providers.filter((provider) => provider.key === "world_bank").length,
    needsKey: data.providers.filter((provider) => provider.status === "needs_api_key").length,
    unavailable: data.series.filter((row) => row.status === "unavailable" || row.sourceStatus === "unavailable").length
  };
  const handleRefresh = () => {
    economicApi.clearDashboardCache();
    setRefreshNonce((value) => value + 1);
  };
  const handleIndicatorSelect = (key: Indicator["key"]) => {
    setSelectedIndicator(key);
    if (key === "gdp") setGdpChartMode("real");
    if (key === "gdp_real") setGdpChartMode("real");
    if (key === "gdp_nominal") setGdpChartMode("nominal");
  };

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">Macro data terminal · v0.1 skeleton</p>
          <h1 id="page-title">經濟數據追蹤</h1>
          <p className="lede">
            以精簡代表組追蹤美國、歐元區與東亞的 GDP、CPI、政策利率，讓後續 ETL 與正式資料源可以直接接上同一套介面。
          </p>
        </div>

        <div className="status-strip" aria-label="system status">
          <span className={isFallback ? "status-dot amber" : "status-dot green"} />
          <span>
            {isLoading
              ? dataMode === "static"
                ? "載入靜態資料"
                : "載入 API"
              : dataMode === "static"
                ? isFallback
                  ? "靜態資料載入失敗"
                  : `靜態資料 · 更新於 ${formatSnapshotTime(data.generatedAt)}`
              : isFallback
                ? "API 未連線 · 無本機資料"
                : selectedUnavailableCount > 0
                  ? "API 已連線 · 官方來源待配置"
                : needsKeyCount > 0
                  ? "API 已連線 · 需要金鑰補齊"
                  : unavailableCount > 0
                    ? "API 已連線 · 部分缺口"
                    : "API 已連線"}
          </span>
          <button className="icon-button" onClick={handleRefresh} title="重新整理目前資料" type="button" aria-label="重新整理目前資料">
            <RefreshCcw size={15} />
          </button>
        </div>
      </section>

      <section className="toolbar" aria-label="dashboard controls">
        <div className="control-group">
          <span className="control-label">指標</span>
          <div className="segmented">
            {data.indicators.map((item) => {
              const definition = indicatorDefinitions[item.key];

              return (
                <span className="indicator-control" key={item.key}>
                  <button
                    aria-describedby={`${item.key}-definition-tooltip`}
                    className={item.key === selectedIndicator ? "indicator-button active" : "indicator-button"}
                    onClick={() => handleIndicatorSelect(item.key)}
                    type="button"
                  >
                    <LineChart size={16} />
                    <span>{item.nameZh}</span>
                    <span className="indicator-info" aria-hidden="true">
                      <Info size={15} />
                    </span>
                  </button>
                  <span className="indicator-tooltip" id={`${item.key}-definition-tooltip`} role="tooltip">
                    <strong>{definition.title}</strong>
                    {definition.lines.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </span>
                </span>
              );
            })}
          </div>
        </div>

        <div className="control-group">
          <span className="control-label">區域</span>
          <div className="segmented compact">
            {(["north_america", "europe", "east_asia", "china"] as const).map((region) => (
              <button
                className={selectedRegion === region ? "active" : ""}
                key={region}
                onClick={() => setSelectedRegion(region)}
                type="button"
              >
                {regionLabels[region]}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <span className="control-label">時間長度</span>
          <div className="segmented compact">
            {rangeOptions.map((range) => (
              <button
                className={selectedRange === range.value ? "active" : ""}
                key={range.value}
                onClick={() => setSelectedRange(range.value)}
                type="button"
              >
                <CalendarDays size={16} />
                {range.label}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <span className="control-label">頻率視圖</span>
          <div className="segmented compact">
            {viewFrequencyOptions.map((option) => (
              <button
                className={selectedViewFrequency === option.value ? "active" : ""}
                key={option.value}
                onClick={() => setSelectedViewFrequency(option.value)}
                type="button"
              >
                <RefreshCcw size={16} />
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="metrics-grid" aria-label="latest indicator snapshot">
        {marketPulse.length > 0 ? (
          marketPulse.map((row) => (
            <article className="metric-card" key={row.id}>
              <div className="metric-head">
                <span>{row.country?.nameZh}</span>
                <span>{row.source}</span>
              </div>
              <strong>
                {formatMetricValue(row.latestValue, row.indicatorKey)}
              </strong>
              <small className={row.change >= 0 ? "positive" : "negative"}>
                {row.change >= 0 ? "+" : ""}
                {formatMetricChange(row.change, row.indicatorKey)} vs prior period · {row.indicator?.nameZh ?? indicator?.nameZh} ·{" "}
                {row.displayUnit ?? indicator?.unit} · {formatDisplayPeriod(row.latestDate, row.indicator?.frequency, selectedViewFrequency)}
              </small>
            </article>
          ))
        ) : (
          <div className="empty-state span-grid">
            {selectedNeedsKeyCount > 0
              ? "此範圍需要官方 API key 才能補齊"
              : selectedUnavailableCount > 0
                ? "此範圍的官方來源尚未配置，校準來源不作前端展示"
                : "來源目前沒有可用觀測值"}
          </div>
        )}
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Time series</p>
              <h2>{chartTitle(indicator, isGdpIndicator, gdpChartMode)}</h2>
            </div>
            {isGdpIndicator ? (
              <div className="segmented compact chart-mode-toggle" aria-label="GDP chart mode">
                {gdpChartModeOptions.map((option) => (
                  <button
                    className={gdpChartMode === option.value ? "active" : ""}
                    key={option.value}
                    onClick={() => setGdpChartMode(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            <RefreshCcw size={18} aria-hidden="true" />
          </div>
          <div className="chart-box" data-testid="trend-chart">
            {comparisonRows.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RechartsLineChart data={comparisonRows} margin={{ top: 12, right: 28, left: 18, bottom: 28 }}>
                  <CartesianGrid stroke="#d8ddda" strokeDasharray="4 6" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value) => formatDisplayPeriod(String(value), indicator?.frequency, selectedViewFrequency)}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={16}
                    padding={{ left: 12, right: 12 }}
                  />
                  <YAxis
                    tickFormatter={(value) => formatAxisValue(value, usesIndexedChart)}
                    tickLine={false}
                    axisLine={false}
                    width={64}
                    tickMargin={14}
                  />
                  <Tooltip
                    labelFormatter={(value) => formatDisplayPeriod(String(value), indicator?.frequency, selectedViewFrequency)}
                    formatter={(value, name, item) => {
                      const seriesName = String(name);
                      const payload = item.payload as Record<string, string | number | undefined> | undefined;
                      const rawValue = payload?.[`${seriesName}__raw`];
                      const seriesIndicatorKey = payload?.[`${seriesName}__indicatorKey`] as Indicator["key"] | undefined;
                      const sourceRow = trendRows.find((row) => row.displayName === seriesName);
                      const unit = String(payload?.[`${seriesName}__unit`] ?? sourceRow?.displayUnit ?? indicator?.unit ?? "");

                      if (usesIndexedChart && typeof rawValue === "number" && seriesIndicatorKey) {
                        return [`${formatChartValue(value)} (${formatTooltipValue(rawValue, seriesIndicatorKey)} ${unit})`, `${seriesName} · 2020=100`];
                      }

                      return [`${formatTooltipValue(value, sourceRow?.indicatorKey ?? selectedIndicator)} ${unit}`.trim(), name];
                    }}
                    contentStyle={{ borderRadius: 8, border: "1px solid #c7d2cc" }}
                  />
                  {trendRows.map((row, index) =>
                    row.country ? (
                      <Line
                        key={row.id}
                        type="monotone"
                        dataKey={row.displayName}
                        stroke={linePalette[index % linePalette.length]}
                        strokeWidth={2.4}
                        connectNulls={selectedIndicator === "policy_rate"}
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                    ) : null
                  )}
                </RechartsLineChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">尚未同步此指標的歷史資料</div>
            )}
          </div>
          {usesIndexedChart && trendRows.length > 1 ? (
            <p className="chart-note">GDP 指數化比較使用 {GDP_BASE_YEAR}=100；卡片與 tooltip 保留原始貨幣單位。</p>
          ) : null}
          {missingBaseYearSeries.length > 0 ? <p className="chart-note muted">未納入指數化：{missingBaseYearSeries.join("；")} 缺少 {GDP_BASE_YEAR} 基準值。</p> : null}
          {selectedIndicator === "policy_rate" && selectedViewFrequency === "quarterly" ? (
            <p className="chart-note">政策利率季度視圖顯示每季最後可用值；切換 Raw 可查看原始時間序列。</p>
          ) : null}
          {missingChartSeries.length > 0 ? <p className="chart-note muted">未顯示：{missingChartSeries.join("；")}。</p> : null}
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Coverage</p>
              <h2>資料完整度</h2>
            </div>
            <Database size={18} aria-hidden="true" />
          </div>
          <dl className="coverage-list">
            <div>
              <dt>官方來源</dt>
              <dd>{providerSummary.official}</dd>
            </div>
            <div>
              <dt>待配置</dt>
              <dd>{providerSummary.pending}</dd>
            </div>
            <div>
              <dt>校準來源</dt>
              <dd>{providerSummary.calibration}</dd>
            </div>
            <div>
              <dt>觀測值</dt>
              <dd>{data.observations.length}</dd>
            </div>
          </dl>
          {providerSummary.pending > 0 || providerSummary.needsKey > 0 ? (
            <p className="provider-note">
              <KeyRound size={15} /> World Bank 僅作校準，不作前端展示；未配置官方來源會保留序列但不顯示數值。
            </p>
          ) : null}
        </article>
      </section>
    </main>
  );
}

const linePalette = ["#0a6b61", "#bb3e2f", "#355c8a", "#c28a12", "#5f5a9a", "#2f7f3f", "#9a4b63", "#51616f"];

const rangeOptions: Array<{ value: ObservationRange; label: string }> = [
  { value: "1y", label: "1Y" },
  { value: "5y", label: "5Y" },
  { value: "10y", label: "10Y" },
  { value: "all", label: "All" }
];

const viewFrequencyOptions: Array<{ value: ViewFrequency; label: string }> = [
  { value: "raw", label: "Raw" },
  { value: "quarterly", label: "Quarterly" }
];

const gdpChartModeOptions: Array<{ value: GdpChartMode; label: string }> = [
  { value: "real", label: "實質 GDP" },
  { value: "nominal", label: "名目 GDP" },
  { value: "indexed", label: "2020=100" }
];

function isGdpIndicatorKey(key: Indicator["key"]) {
  return key === "gdp" || key === "gdp_real" || key === "gdp_nominal";
}

function mergeDashboardPayloads(...payloads: DashboardPayload[]): DashboardPayload {
  const [primary = fallbackData] = payloads;
  return {
    ...primary,
    series: uniqueBy(payloads.flatMap((payload) => payload.series), (item) => item.id),
    observations: uniqueBy(payloads.flatMap((payload) => payload.observations), (item) => `${item.seriesId}:${item.date}`),
    releases: uniqueBy(payloads.flatMap((payload) => payload.releases), (item) => `${item.seriesId}:${item.date}:${item.eventType}`),
    dataQualityWarnings: payloads.flatMap((payload) => payload.dataQualityWarnings)
  };
}

function uniqueBy<T>(items: T[], keyFor: (item: T) => string) {
  const byKey = new Map<string, T>();
  items.forEach((item) => {
    byKey.set(keyFor(item), item);
  });
  return Array.from(byKey.values());
}

function buildSeriesRows(seriesItems: Series[], observations: Observation[], countries: Country[], indicators: Indicator[]): SeriesRow[] {
  const countryByCode = new Map(countries.map((country) => [country.code, country]));
  const indicatorByKey = new Map(indicators.map((indicator) => [indicator.key, indicator]));

  return seriesItems
    .filter((item) => item.status !== "unavailable")
    .map((item): SeriesRow | undefined => {
      const points = observations
        .filter((observation) => observation.seriesId === item.id)
        .sort((a, b) => a.date.localeCompare(b.date));

      if (points.length === 0) return undefined;
      const latest = points[points.length - 1];
      const previous = points.at(-2);
      const country = countryByCode.get(item.countryCode);
      const indicator = indicatorByKey.get(item.indicatorKey);
      const displayName = isGdpIndicatorKey(item.indicatorKey)
        ? `${country?.nameZh ?? item.countryCode} · ${item.indicatorKey === "gdp_real" ? "實質" : "名目"}`
        : country?.nameZh ?? item.countryCode;

      return {
        ...item,
        country,
        indicator,
        points,
        latestValue: latest.value,
        latestDate: latest.date,
        displayUnit: latest.unit ?? item.unit ?? indicator?.unit,
        change: latest && previous ? latest.value - previous.value : 0,
        displayName
      };
    })
    .filter((item): item is SeriesRow => Boolean(item));
}

function baseValueForYear(points: Observation[], baseYear: string) {
  const baseYearPoints = points.filter((point) => point.period?.startsWith(baseYear) || point.date.startsWith(baseYear));
  if (baseYearPoints.length === 0) return undefined;
  return baseYearPoints.reduce((sum, point) => sum + point.value, 0) / baseYearPoints.length;
}

function chartTitle(indicator: Indicator | undefined, isGdpIndicator: boolean, mode: GdpChartMode) {
  if (!isGdpIndicator) return `${indicator?.nameZh ?? "指標"} 趨勢比較`;
  if (mode === "indexed") return "GDP 指數化比較";
  return `${mode === "real" ? "實質 GDP" : "名目 GDP"} 趨勢比較`;
}

function formatMetricValue(value: number, indicatorKey: Indicator["key"]) {
  return value.toLocaleString("zh-Hant", {
    maximumFractionDigits: indicatorKey === "gdp_real" ? 3 : 2
  });
}

function formatMetricChange(value: number, indicatorKey: Indicator["key"]) {
  return value.toLocaleString("zh-Hant", {
    maximumFractionDigits: indicatorKey === "gdp_real" ? 3 : 2,
    minimumFractionDigits: indicatorKey === "gdp_real" ? 3 : 2
  });
}

function formatTooltipValue(value: unknown, indicatorKey: Indicator["key"]) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value);
  return formatMetricValue(numericValue, indicatorKey);
}

function formatChartValue(value: unknown) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value);
  return numericValue.toLocaleString("zh-Hant", {
    maximumFractionDigits: 2
  });
}

function formatAxisValue(value: unknown, isIndexedChart: boolean) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return String(value);
  return numericValue.toLocaleString("zh-Hant", {
    maximumFractionDigits: isIndexedChart ? 0 : 2
  });
}

function formatSnapshotTime(value: string | undefined) {
  if (!value) return "時間未知";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-Hant", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai"
  }).format(date);
}

function formatDateTick(date: string, frequency: Indicator["frequency"] | undefined) {
  if (frequency === "quarterly" || date.includes("-Q")) return periodForDate(date);
  if (frequency === "annual") return date.slice(0, 4);
  if (frequency === "monthly") return date.slice(0, 7);
  return date.slice(0, 10);
}

function formatDisplayPeriod(date: string, frequency: Indicator["frequency"] | undefined, viewFrequency: ViewFrequency) {
  if (viewFrequency === "quarterly") return periodForDate(date);
  return formatDateTick(date, frequency);
}

function filterReleasesByRange(releases: ReleaseEvent[], range: ObservationRange) {
  const keys = new Set(filterByRange(releases.map((item) => ({ ...item, value: item.actual ?? 0, updatedAt: item.date })), range).map((item) => item.date));
  return releases.filter((item) => keys.has(item.date));
}

function applyLocalViewFrequency(observations: Observation[], viewFrequency: ViewFrequency) {
  if (viewFrequency !== "quarterly") return observations;
  const bySeriesQuarter = new Map<string, { sourceDate: string; observation: Observation }>();

  observations.forEach((item) => {
    const period = periodForDate(item.date);
    const key = `${item.seriesId}:${period}`;
    const previous = bySeriesQuarter.get(key);
    if (!previous || item.date > previous.sourceDate) {
      bySeriesQuarter.set(key, { sourceDate: item.date, observation: { ...item, date: quarterEndDate(period), period, frequency: "quarterly" } });
    }
  });

  return Array.from(bySeriesQuarter.values())
    .map((item) => item.observation)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function periodForDate(date: string) {
  if (date.includes("-Q")) return date;
  const month = Number(date.slice(5, 7));
  return `${date.slice(0, 4)}-Q${Math.ceil(month / 3)}`;
}

function quarterEndDate(period: string) {
  const [year, rawQuarter] = period.split("-Q");
  return `${year}-${["03-31", "06-30", "09-30", "12-31"][Number(rawQuarter) - 1]}`;
}

function filterByRange(observations: Observation[], range: ObservationRange) {
  if (range === "all") return observations;
  const sorted = observations.slice().sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1)?.date;
  if (!latest) return sorted;

  const start = new Date(`${latest.slice(0, 10)}T00:00:00.000Z`);
  start.setUTCFullYear(start.getUTCFullYear() - (range === "1y" ? 1 : range === "5y" ? 5 : 10));
  const startKey = start.toISOString().slice(0, 10);
  return sorted.filter((item) => item.date >= startKey);
}
