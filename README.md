# 經濟數據追蹤

React + TypeScript、Node.js + Express、Prisma/PostgreSQL 的 monorepo，用來追蹤美國、歐盟與東亞代表經濟指標，並保留 GDP、CPI、政策利率的歷史觀測值。

## 專案結構

- `frontend/`：Vite React dashboard，使用 Recharts 與 lucide-react。
- `backend/`：Express API，提供公開讀取的 v1 economic data endpoints。
- `backend/prisma/`：PostgreSQL schema 與初始 migration。
- `infra/`：Docker Compose，本地啟動 Postgres、Redis、backend、frontend。
- `docs/`：資料來源策略與後續 ETL 記錄。
- `scripts/`：預留 ETL 與維運腳本。

## 本地開發

```bash
npm install
npm run dev
```

前端預設在 `http://localhost:5173`，後端 API 預設在 `http://localhost:8787`。

也可以分開啟動：

```bash
npm run dev --workspace frontend
npm run dev --workspace backend
```

若要使用真實歷史資料，先啟動 PostgreSQL、套用 migration，然後執行同步：

```bash
npm run prisma:validate --workspace backend
npx prisma migrate deploy --schema backend/prisma/schema.prisma
npm run sync --workspace backend
```

`ENABLE_SCHEDULER=true` 時，後端會定期檢查是否有到期的發布日資料需要同步；資料本身依各國/各指標發布規則更新，不做每日資料更新。可用 `US_CPI_RELEASE_DATES=YYYY-MM-DD,YYYY-MM-DD` 這類 `COUNTRY_INDICATOR_RELEASE_DATES` 覆寫特定序列，政策利率也支援既有 `POLICY_RATE_RELEASE_DATES`。

混合來源支援可選金鑰：

```text
FRED_API_KEY=...
ESTAT_APP_ID=...
ESTAT_GDP_STATS_DATA_ID=...
ESTAT_GDP_NOMINAL_STATS_DATA_ID=...
ESTAT_CPI_STATS_DATA_ID=...
KOSIS_API_KEY=...
ECOS_API_KEY=...
NBS_DIRECT_ENABLED=false
NBS_DIRECT_TIMEOUT_MS=8000
```

Japan e-Stat 的 GDP/CPI 欄位使用統計ダッシュボード 19 位 `IndicatorCode`；例如總合 CPI 前年同月比使用 `0703010501010030000`。

沒有金鑰時，相關來源會標示 `needs_api_key`，不會用 mock 或 World Bank 補成前端真實資料。World Bank 僅作校準來源，不進入 dashboard observations/releases；官方來源尚未配置時，前端會保留序列並顯示待配置狀態。

中國名目 GDP 與 CPI 預設使用 DBnomics 的 NBS 鏡像。CPI 依統計分類有效期間切換 NBS 指標碼，鏡像缺值時以 DBnomics IMF CPI 指數補齊；每筆 observation 會保留實際來源。可用 `NBS_DIRECT_ENABLED=true` 開啟國家統計局 EasyQuery 直連，直連失敗時仍會降級至鏡像。中國可比實質 GDP 水準尚未配置，因此不會將 GDP 同比成長率混入跨國實質 GDP 圖。

## Docker

```bash
docker compose -f infra/docker-compose.yml up --build
```

PostgreSQL 使用：

```text
postgresql://economic:economic@localhost:5432/economic_data?schema=public
```

Redis 使用：

```text
redis://localhost:6379
```

## GitHub Pages 靜態版

本機開發預設使用 Express API 與 PostgreSQL；GitHub Pages 使用預先產生的
`frontend/public/data/dashboard.json`，不需要也不會在瀏覽器內執行後端。

首次產生或完整重建靜態資料：

```bash
npm run static:sync:full
VITE_BASE_PATH=/economic-data-tracker/ npm run build:static
VITE_BASE_PATH=/economic-data-tracker/ npm run preview:static --workspace frontend
```

GitHub 設定：

1. 建立公開 repository，預設分支使用 `main`。
2. 在 **Settings → Pages → Build and deployment** 選擇 **GitHub Actions**。
3. 在 **Settings → Secrets and variables → Actions** 建立 Secrets：
   `FRED_API_KEY`、`ESTAT_APP_ID`。
4. 在同一頁的 Variables 建立日本序列 ID：
   `ESTAT_GDP_STATS_DATA_ID`、`ESTAT_GDP_NOMINAL_STATS_DATA_ID`、
   `ESTAT_CPI_STATS_DATA_ID`。
5. 手動執行 **Static dashboard** workflow 的 `full` 模式完成首次部署。

workflow 會在 UTC `01:17`、`07:17`、`13:17`、`19:17` 檢查到期序列，
並在每週日 UTC `02:27` 執行十年歷史校正。精確官方發布時間可加入
`backend/src/data/releaseCalendar.ts`；環境變數覆寫的優先級更高。

單一資料來源暫時失敗時，快照會保留最後成功資料並標記為 `stale`，
最多隔日重試三次。靜態快照若完全沒有觀測值，workflow 會停止部署。

`backend/.env` 與 `frontend/.env` 只供本機使用，已由 `.gitignore` 排除；
不要將任何 API key 寫入 workflow、快照或程式碼。

## API

所有成功回應使用 `{ "data": ... }`，錯誤回應使用：

```json
{
  "error": {
    "code": "not_found",
    "message": "Route not found"
  }
}
```

Endpoints:

- `GET /api/health`
- `GET /api/v1/countries`
- `GET /api/v1/indicators`
- `GET /api/v1/series`
- `GET /api/v1/observations`
- `GET /api/v1/releases`
- `GET /api/v1/providers`

`series` 與 `observations` 支援 `countryCode`、`indicatorKey` 查詢參數，`observations` 也支援 `seriesId`、`from`、`to`、`range=1y|5y|10y|all`、`viewFrequency=raw|quarterly`。

`releases` 回傳 GDP/CPI 公布與央行利率決議事件；`providers` 回傳資料來源、金鑰需求與覆蓋狀態。

## 首版資料範圍

地區：美國、歐盟整體、德國、法國、日本、韓國、中國、台灣。

指標：GDP、CPI、政策利率。GDP 優先季度名目總量資料，CPI 優先月資料，政策利率保留決議日/生效日事件，前端可切換 Raw 與 Quarterly 視圖。

後端有 `DATABASE_URL` 時會使用 PostgreSQL；缺少資料庫設定時，測試與本地預覽會退回只讀 fixture data。真實同步優先使用免費公開來源，詳見 `docs/data-sources.md`。

## 驗證

```bash
npm run prisma:validate
npm run sync --workspace backend
npm run lint
npm test
npm run build
```
