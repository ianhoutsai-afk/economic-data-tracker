import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import {
  TrendingUp,
  Globe,
  Users,
  Percent,
  DollarSign,
  Layers,
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Search,
  Download
} from 'lucide-react';

// ==========================================
// 1. 型別與介面定義 (TypeScript Types)
// ==========================================
type Locale = 'zh-TW' | 'en';
type IndicatorType = 'gdp' | 'gdp_nominal' | 'cpi' | 'inflation_rate' | 'interestRate' | 'unemployment';
type RegionType = 'ALL' | 'US' | 'EU' | 'EA'; // EA: East Asia

interface DataPoint {
  date: string;
  US: number;
  EU: number;
  EA: number;
}

interface IndicatorMeta {
  id: IndicatorType;
  nameZh: string;
  nameEn: string;
  unit: string;
  icon: React.ReactNode;
}

// ==========================================
// 2. 翻譯字典 (i18n Dictionary)
// ==========================================
const translations = {
  'zh-TW': {
    title: '全球宏觀經濟指標儀表板',
    subtitle: '即時追蹤與對比歐盟、東亞及美國核心經濟數據',
    region: '地區',
    indicator: '經濟指標',
    allRegions: '所有地區',
    us: '美國 (US)',
    eu: '歐盟 (EU)',
    ea: '東亞 (EA)',
    gdp: '國內生產總值 (GDP)',
    cpi: '消費者物價指數 (CPI)',
    interestRate: '政策利率',
    unemployment: '失業率',
    searchPlaceholder: '搜尋數據...',
    exportCsv: '匯出 CSV',
    latestValue: '最新數值',
    quarterlyChange: '季度變動',
    historyTrend: '歷史走勢與跨區對比',
    dataTable: '詳細數據清單',
    date: '日期',
    source: '數據來源：FRED, Eurostat, World Bank (模擬測試數據)',
    footer: '© 2026 GlobalEco Project. 保留所有權利。'
  },
  en: {
    title: 'Global Macroeconomic Indicators',
    subtitle: 'Real-time tracking and comparison of key data for EU, East Asia, and US',
    region: 'Region',
    indicator: 'Indicator',
    allRegions: 'All Regions',
    us: 'United States (US)',
    eu: 'European Union (EU)',
    ea: 'East Asia (EA)',
    gdp: 'Gross Domestic Product (GDP)',
    cpi: 'Consumer Price Index (CPI)',
    interestRate: 'Policy Interest Rate',
    unemployment: 'Unemployment Rate',
    searchPlaceholder: 'Search data...',
    exportCsv: 'Export CSV',
    latestValue: 'Latest Value',
    quarterlyChange: 'Change',
    historyTrend: 'Historical Trend & Comparison',
    dataTable: 'Detailed Data Table',
    date: 'Date',
    source: 'Sources: FRED, Eurostat, World Bank (Mock Data for Demo)',
    footer: '© 2026 GlobalEco Project. All rights reserved.'
  }
};

// ==========================================
// 3. 模擬數據源 (Mock Database)
// ==========================================
const indicatorsMeta: Record<IndicatorType, IndicatorMeta> = {
  gdp: { id: 'gdp', nameZh: '實質 GDP 年增率', nameEn: 'Real GDP Growth Rate (YoY)', unit: '%', icon: <TrendingUp className="w-5 h-5 text-blue-400" /> },
  gdp_nominal: { id: 'gdp_nominal', nameZh: '名目 GDP 年增率', nameEn: 'Nominal GDP Growth Rate (YoY)', unit: '%', icon: <DollarSign className="w-5 h-5 text-cyan-400" /> },
  cpi: { id: 'cpi', nameZh: '消費者物價指數 (CPI)', nameEn: 'Consumer Price Index (CPI)', unit: '%', icon: <Layers className="w-5 h-5 text-amber-400" /> },
  inflation_rate: { id: 'inflation_rate', nameZh: '通膨率', nameEn: 'Inflation Rate', unit: '%', icon: <TrendingUp className="w-5 h-5 text-red-400" /> },
  interestRate: { id: 'interestRate', nameZh: '中央銀行基準利率', nameEn: 'Policy Interest Rate', unit: '%', icon: <Percent className="w-5 h-5 text-emerald-400" /> },
  unemployment: { id: 'unemployment', nameZh: '失業率', nameEn: 'Unemployment Rate', unit: '%', icon: <Users className="w-5 h-5 text-rose-400" /> },
};

const mockDatabase: Record<IndicatorType, DataPoint[]> = {
  gdp: [
    { date: '2023-Q1', US: 2.2, EU: 1.1, EA: 3.5 },
    { date: '2023-Q2', US: 2.4, EU: 0.8, EA: 3.2 },
    { date: '2023-Q3', US: 4.9, EU: 0.5, EA: 3.0 },
    { date: '2023-Q4', US: 3.1, EU: 0.2, EA: 3.6 },
    { date: '2024-Q1', US: 1.6, EU: 0.4, EA: 4.1 },
    { date: '2024-Q2', US: 2.0, EU: 0.6, EA: 3.9 },
    { date: '2024-Q3', US: 2.8, EU: 0.9, EA: 4.0 },
    { date: '2024-Q4', US: 2.5, EU: 1.0, EA: 4.2 },
    { date: '2025-Q1', US: 2.1, EU: 1.1, EA: 4.3 },
    { date: '2025-Q2', US: 1.9, EU: 1.3, EA: 4.1 },
    { date: '2025-Q3', US: 2.2, EU: 1.4, EA: 4.4 },
    { date: '2025-Q4', US: 2.4, EU: 1.5, EA: 4.5 },
  ],
  gdp_nominal: [
    { date: '2023-Q1', US: 6.3, EU: 3.2, EA: 4.8 },
    { date: '2023-Q2', US: 5.8, EU: 2.9, EA: 4.5 },
    { date: '2023-Q3', US: 7.1, EU: 2.6, EA: 4.3 },
    { date: '2023-Q4', US: 5.5, EU: 2.3, EA: 4.9 },
    { date: '2024-Q1', US: 4.8, EU: 2.5, EA: 5.2 },
    { date: '2024-Q2', US: 5.2, EU: 2.7, EA: 5.0 },
    { date: '2024-Q3', US: 5.6, EU: 3.0, EA: 5.1 },
    { date: '2024-Q4', US: 5.0, EU: 3.1, EA: 5.3 },
    { date: '2025-Q1', US: 4.5, EU: 3.2, EA: 5.4 },
    { date: '2025-Q2', US: 4.3, EU: 3.4, EA: 5.2 },
    { date: '2025-Q3', US: 4.7, EU: 3.5, EA: 5.5 },
    { date: '2025-Q4', US: 4.9, EU: 3.6, EA: 5.6 },
  ],
  cpi: [
    { date: '2023-Q1', US: 5.0, EU: 6.9, EA: 2.1 },
    { date: '2023-Q2', US: 4.0, EU: 5.5, EA: 1.8 },
    { date: '2023-Q3', US: 3.7, EU: 4.3, EA: 1.5 },
    { date: '2023-Q4', US: 3.4, EU: 2.9, EA: 1.2 },
    { date: '2024-Q1', US: 3.5, EU: 2.4, EA: 1.3 },
    { date: '2024-Q2', US: 3.0, EU: 2.5, EA: 1.5 },
    { date: '2024-Q3', US: 2.4, EU: 2.2, EA: 1.1 },
    { date: '2024-Q4', US: 2.1, EU: 2.0, EA: 1.0 },
    { date: '2025-Q1', US: 2.3, EU: 1.9, EA: 0.9 },
    { date: '2025-Q2', US: 2.5, EU: 1.8, EA: 1.2 },
    { date: '2025-Q3', US: 2.4, EU: 1.7, EA: 1.4 },
    { date: '2025-Q4', US: 2.2, EU: 1.6, EA: 1.5 },
  ],
  inflation_rate: [
    { date: '2023-Q1', US: 5.0, EU: 6.9, EA: 2.1 },
    { date: '2023-Q2', US: 4.0, EU: 5.5, EA: 1.8 },
    { date: '2023-Q3', US: 3.7, EU: 4.3, EA: 1.5 },
    { date: '2023-Q4', US: 3.4, EU: 2.9, EA: 1.2 },
    { date: '2024-Q1', US: 3.5, EU: 2.4, EA: 1.3 },
    { date: '2024-Q2', US: 3.0, EU: 2.5, EA: 1.5 },
    { date: '2024-Q3', US: 2.4, EU: 2.2, EA: 1.1 },
    { date: '2024-Q4', US: 2.1, EU: 2.0, EA: 1.0 },
    { date: '2025-Q1', US: 2.3, EU: 1.9, EA: 0.9 },
    { date: '2025-Q2', US: 2.5, EU: 1.8, EA: 1.2 },
    { date: '2025-Q3', US: 2.4, EU: 1.7, EA: 1.4 },
    { date: '2025-Q4', US: 2.2, EU: 1.6, EA: 1.5 },
  ],
  interestRate: [
    { date: '2023-Q1', US: 4.75, EU: 3.50, EA: 0.10 },
    { date: '2023-Q2', US: 5.00, EU: 4.00, EA: 0.10 },
    { date: '2023-Q3', US: 5.25, EU: 4.50, EA: 0.10 },
    { date: '2023-Q4', US: 5.50, EU: 4.50, EA: 0.10 },
    { date: '2024-Q1', US: 5.50, EU: 4.50, EA: 0.25 },
    { date: '2024-Q2', US: 5.50, EU: 4.25, EA: 0.25 },
    { date: '2024-Q3', US: 5.00, EU: 3.75, EA: 0.25 },
    { date: '2024-Q4', US: 4.50, EU: 3.25, EA: 0.25 },
    { date: '2025-Q1', US: 4.00, EU: 3.00, EA: 0.25 },
    { date: '2025-Q2', US: 3.75, EU: 2.75, EA: 0.50 },
    { date: '2025-Q3', US: 3.50, EU: 2.50, EA: 0.50 },
    { date: '2025-Q4', US: 3.25, EU: 2.25, EA: 0.50 },
  ],
  unemployment: [
    { date: '2023-Q1', US: 3.5, EU: 6.6, EA: 2.8 },
    { date: '2023-Q2', US: 3.6, EU: 6.5, EA: 2.7 },
    { date: '2023-Q3', US: 3.8, EU: 6.5, EA: 2.9 },
    { date: '2023-Q4', US: 3.7, EU: 6.4, EA: 2.8 },
    { date: '2024-Q1', US: 3.8, EU: 6.5, EA: 2.6 },
    { date: '2024-Q2', US: 4.0, EU: 6.5, EA: 2.5 },
    { date: '2024-Q3', US: 4.1, EU: 6.3, EA: 2.6 },
    { date: '2024-Q4', US: 4.2, EU: 6.3, EA: 2.7 },
    { date: '2025-Q1', US: 4.3, EU: 6.2, EA: 2.8 },
    { date: '2025-Q2', US: 4.4, EU: 6.1, EA: 2.9 },
    { date: '2025-Q3', US: 4.2, EU: 6.1, EA: 2.8 },
    { date: '2025-Q4', US: 4.0, EU: 6.0, EA: 2.7 },
  ],
};

// ==========================================
// 4. 輔助函式 (Helper Functions)
// ==========================================
const getLatestStats = (indicator: IndicatorType) => {
  const data = mockDatabase[indicator];
  const latest = data[data.length - 1];
  const previous = data[data.length - 2];

  return {
    latest,
    changes: {
      US: parseFloat((latest.US - previous.US).toFixed(2)),
      EU: parseFloat((latest.EU - previous.EU).toFixed(2)),
      EA: parseFloat((latest.EA - previous.EA).toFixed(2)),
    }
  };
};

// ==========================================
// 5. 主頁面組件 (Main Dashboard Component)
// ==========================================
export default function Dashboard() {
  const [locale, setLocale] = useState<Locale>('zh-TW');
  const [selectedIndicator, setSelectedIndicator] = useState<IndicatorType>('gdp');
  const [selectedRegion, setSelectedRegion] = useState<RegionType>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [timeRange, setTimeRange] = useState<'all' | '3y' | '1y'>('all');

  const t = translations[locale];

  // 根據時間篩選後的圖表數據
  const filteredChartData = useMemo(() => {
    const rawData = mockDatabase[selectedIndicator];
    if (timeRange === '1y') {
      return rawData.slice(-4); // 取得最近四季
    }
    if (timeRange === '3y') {
      return rawData.slice(-12); // 取得最近12季
    }
    return rawData;
  }, [selectedIndicator, timeRange]);

  // 取得當前所選指標的最新與異動數據
  const stats = useMemo(() => {
    return getLatestStats(selectedIndicator);
  }, [selectedIndicator]);

  // 處理 CSV 匯出
  const exportToCSV = () => {
    const data = mockDatabase[selectedIndicator];
    const headers = 'Date,US,EU,East_Asia\n';
    const csvContent = data.map(row => `${row.date},${row.US},${row.EU},${row.EA}`).join('\n');
    const blob = new Blob([headers + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${selectedIndicator}_data_${locale}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row font-sans">

      {/* 側邊導覽列 */}
      <aside className="w-full md:w-64 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 p-6 flex flex-col justify-between shrink-0">
        <div>
          {/* Logo */}
          <div className="flex items-center space-x-3 mb-8">
            <div className="p-2 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-lg shadow-md shadow-indigo-500/20">
              <Globe className="w-6 h-6 text-white" />
            </div>
            <span className="font-bold text-xl bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">
              GlobalEco
            </span>
          </div>

          {/* 指標選單 */}
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block px-3 mb-2">
              {t.indicator}
            </span>
            {(Object.keys(indicatorsMeta) as IndicatorType[]).map((key) => {
              const meta = indicatorsMeta[key];
              const isActive = selectedIndicator === key;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedIndicator(key)}
                  className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition duration-200 ${
                    isActive
                      ? 'bg-slate-800 text-blue-400 shadow-sm border-l-4 border-blue-500'
                      : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                  }`}
                >
                  {meta.icon}
                  <span>{locale === 'zh-TW' ? meta.nameZh : meta.nameEn}</span>
                </button>
              );
            })}
          </div>

          {/* 區域過濾器 */}
          <div className="mt-8 space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block px-3 mb-2">
              {t.region}
            </span>
            {[
              { id: 'ALL', label: t.allRegions },
              { id: 'US', label: t.us },
              { id: 'EU', label: t.eu },
              { id: 'EA', label: t.ea },
            ].map((reg) => {
              const isActive = selectedRegion === reg.id;
              return (
                <button
                  key={reg.id}
                  onClick={() => setSelectedRegion(reg.id as RegionType)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition duration-150 ${
                    isActive
                      ? 'bg-slate-800 text-slate-100 border border-slate-700'
                      : 'text-slate-400 hover:bg-slate-800/30 hover:text-slate-200'
                  }`}
                >
                  <span>{reg.label}</span>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* 底部數據源註記 */}
        <div className="mt-8 pt-4 border-t border-slate-800 text-[11px] text-slate-500 space-y-2">
          <p>{t.source}</p>
        </div>
      </aside>

      {/* 右側主內容區 */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">

        {/* 頂部導航欄 */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-100">{t.title}</h1>
            <p className="text-xs text-slate-400 mt-1">{t.subtitle}</p>
          </div>

          {/* 語系切換 */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1">
            <button
              onClick={() => setLocale('zh-TW')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
                locale === 'zh-TW'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              繁中
            </button>
            <button
              onClick={() => setLocale('en')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
                locale === 'en'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              EN
            </button>
          </div>
        </header>

        {/* 頂部：數據指標概覽卡片區 */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* 美國卡片 */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm hover:border-slate-700 transition">
            <div className="flex justify-between items-start">
              <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-950 text-blue-300 border border-blue-900">
                {t.us}
              </span>
              <span className="text-xs text-slate-500">{stats.latest.date}</span>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-bold tracking-tight text-slate-100">{stats.latest.US}%</span>
              <span className="text-xs text-slate-500 ml-1.5">{indicatorsMeta[selectedIndicator].unit}</span>
            </div>
            <div className="flex items-center space-x-1.5 mt-3 text-xs">
              {stats.changes.US >= 0 ? (
                <span className="text-emerald-500 flex items-center font-medium">
                  <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> +{stats.changes.US}%
                </span>
              ) : (
                <span className="text-rose-500 flex items-center font-medium">
                  <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" /> {stats.changes.US}%
                </span>
              )}
              <span className="text-slate-500">vs 續季變動</span>
            </div>
          </div>

          {/* 歐盟卡片 */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm hover:border-slate-700 transition">
            <div className="flex justify-between items-start">
              <span className="text-xs font-semibold px-2 py-1 rounded bg-amber-950 text-amber-300 border border-amber-900">
                {t.eu}
              </span>
              <span className="text-xs text-slate-500">{stats.latest.date}</span>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-bold tracking-tight text-slate-100">{stats.latest.EU}%</span>
              <span className="text-xs text-slate-500 ml-1.5">{indicatorsMeta[selectedIndicator].unit}</span>
            </div>
            <div className="flex items-center space-x-1.5 mt-3 text-xs">
              {stats.changes.EU >= 0 ? (
                <span className="text-emerald-500 flex items-center font-medium">
                  <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> +{stats.changes.EU}%
                </span>
              ) : (
                <span className="text-rose-500 flex items-center font-medium">
                  <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" /> {stats.changes.EU}%
                </span>
              )}
              <span className="text-slate-500">vs 續季變動</span>
            </div>
          </div>

          {/* 東亞卡片 */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm hover:border-slate-700 transition">
            <div className="flex justify-between items-start">
              <span className="text-xs font-semibold px-2 py-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-900">
                {t.ea}
              </span>
              <span className="text-xs text-slate-500">{stats.latest.date}</span>
            </div>
            <div className="mt-4">
              <span className="text-3xl font-bold tracking-tight text-slate-100">{stats.latest.EA}%</span>
              <span className="text-xs text-slate-500 ml-1.5">{indicatorsMeta[selectedIndicator].unit}</span>
            </div>
            <div className="flex items-center space-x-1.5 mt-3 text-xs">
              {stats.changes.EA >= 0 ? (
                <span className="text-emerald-500 flex items-center font-medium">
                  <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> +{stats.changes.EA}%
                </span>
              ) : (
                <span className="text-rose-500 flex items-center font-medium">
                  <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" /> {stats.changes.EA}%
                </span>
              )}
              <span className="text-slate-500">vs 續季變動</span>
            </div>
          </div>
        </section>

        {/* 中部：時序互動圖表 */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 md:p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div>
              <h3 className="text-md font-semibold text-slate-200 flex items-center space-x-2">
                <span>{t.historyTrend}</span>
                <span className="text-xs font-normal text-slate-400">
                  ({locale === 'zh-TW' ? indicatorsMeta[selectedIndicator].nameZh : indicatorsMeta[selectedIndicator].nameEn})
                </span>
              </h3>
            </div>

            {/* 時間區間與功能控制 */}
            <div className="flex items-center space-x-3 w-full sm:w-auto">
              {/* 時間切換 */}
              <div className="flex bg-slate-800 border border-slate-700 p-1 rounded-lg text-xs">
                {[
                  { id: '1y', label: '1Y' },
                  { id: '3y', label: '3Y' },
                  { id: 'all', label: 'MAX' }
                ].map((range) => (
                  <button
                    key={range.id}
                    onClick={() => setTimeRange(range.id as 'all' | '3y' | '1y')}
                    className={`px-3 py-1 rounded-md transition ${
                      timeRange === range.id
                        ? 'bg-slate-700 text-blue-400 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>

              {/* CSV 匯出 */}
              <button
                onClick={exportToCSV}
                className="flex items-center space-x-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t.exportCsv}</span>
              </button>
            </div>
          </div>

          {/* Recharts 折線圖 */}
          <div className="h-80 md:h-96 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={filteredChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="date"
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickFormatter={(val) => `${val}%`}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '12px'
                  }}
                />
                <Legend
                  verticalAlign="top"
                  height={36}
                  iconType="circle"
                  wrapperStyle={{ fontSize: '12px', paddingBottom: '10px' }}
                />
                {/* 根據左側選中的 Region 決定要顯示哪幾條線 */}
                {(selectedRegion === 'ALL' || selectedRegion === 'US') && (
                  <Line
                    type="monotone"
                    dataKey="US"
                    name={t.us}
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    activeDot={{ r: 6 }}
                    dot={{ strokeWidth: 2, r: 2 }}
                  />
                )}
                {(selectedRegion === 'ALL' || selectedRegion === 'EU') && (
                  <Line
                    type="monotone"
                    dataKey="EU"
                    name={t.eu}
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    dot={{ strokeWidth: 2, r: 2 }}
                  />
                )}
                {(selectedRegion === 'ALL' || selectedRegion === 'EA') && (
                  <Line
                    type="monotone"
                    dataKey="EA"
                    name={t.ea}
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ strokeWidth: 2, r: 2 }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* 底部：詳細數據清單與過濾表格 */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
            <h3 className="text-md font-semibold text-slate-200">{t.dataTable}</h3>

            {/* 搜尋欄位 */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={t.searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 transition placeholder-slate-600"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 tracking-wider">
                  <th className="py-3 px-4">{t.date}</th>
                  {(selectedRegion === 'ALL' || selectedRegion === 'US') && <th className="py-3 px-4">{t.us}</th>}
                  {(selectedRegion === 'ALL' || selectedRegion === 'EU') && <th className="py-3 px-4">{t.eu}</th>}
                  {(selectedRegion === 'ALL' || selectedRegion === 'EA') && <th className="py-3 px-4">{t.ea}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 text-xs">
                {mockDatabase[selectedIndicator]
                  .filter((row) => row.date.toLowerCase().includes(searchTerm.toLowerCase()))
                  .map((row) => (
                    <tr key={row.date} className="hover:bg-slate-800/30 transition text-slate-300">
                      <td className="py-3.5 px-4 font-medium text-slate-400">{row.date}</td>
                      {(selectedRegion === 'ALL' || selectedRegion === 'US') && (
                        <td className="py-3.5 px-4">{row.US}%</td>
                      )}
                      {(selectedRegion === 'ALL' || selectedRegion === 'EU') && (
                        <td className="py-3.5 px-4">{row.EU}%</td>
                      )}
                      {(selectedRegion === 'ALL' || selectedRegion === 'EA') && (
                        <td className="py-3.5 px-4">{row.EA}%</td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 頁尾 */}
        <footer className="text-center md:text-left text-[11px] text-slate-600 mt-12 pt-6 border-t border-slate-900 flex flex-col md:flex-row justify-between items-center gap-2">
          <p>{t.footer}</p>
        </footer>
      </main>
    </div>
  );
}