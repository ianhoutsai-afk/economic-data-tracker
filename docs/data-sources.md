# 資料來源策略

目前後端支援 PostgreSQL 歷史資料儲存與同步工作。同步優先採用免費且可公開讀取的資料來源；缺少資料庫設定時，前端與測試仍可使用只讀 fixture data。

## 指標對應

- GDP：美國優先 FRED `GDP`/`GDPC1`（需要 `FRED_API_KEY`），歐洲投資板塊採 Eurostat 歐元區季度 GDP，Eurostat 寫入前由百萬歐元正規化為十億歐元。日本 e-Stat、韓國 ECOS 是官方目標來源；中國名目 GDP 採 DBnomics 的 NBS `Q_A0101/A010101` 鏡像並可選擇啟用 EasyQuery 直連，中國可比實質 GDP 水準與台灣 GDP 仍標示為待配置。
- CPI：美國優先 BLS public API 月資料，歐洲投資板塊採 Eurostat 歐元區 HICP 月資料，台灣優先 data.gov.tw open data。日本/韓國可在取得免費官方 key 與序列 ID 後切到 e-Stat/KOSIS/ECOS；中國 CPI 優先採 NBS 同比指數並以 IMF CPI 補缺。
- 政策利率：美國優先 FRED/FOMC，歐洲投資板塊採 ECB Data Portal 歐元區政策利率，其他國家用 BIS `WS_CBPOL` 免費 fallback；系統保留真實決議日/生效日，再衍生季度視圖。
- World Bank：僅作校準來源，用於和官方/主來源比對產生資料品質警示；不作為前端展示來源，也不寫入 dashboard observations/releases。

## 首版地區

- 美國
- 歐元區 / ECB 口徑
- 日本
- 韓國
- 中國
- 台灣

## 接入原則

- 保留原始來源名稱於 `Series.source` 與 `Observation.source`。
- `Series.unit` 與 `Observation.unit` 必須標明顯示單位；例如 FRED `GDP` 顯示為 `billion USD, SAAR`，Eurostat `CP_MEUR` 正規化後顯示為 `billion EUR`。
- 使用 `(seriesId, date)` upsert，避免重複觀測值並保留歷史資料。
- 使用 `ReleaseEvent` 保存 GDP/CPI 公布與央行利率決議事件。
- `viewFrequency=quarterly` 以每季最後可用值產生季度比較，不改寫原始觀測資料。
- `Series.lastSyncedAt`、`Series.nextReleaseDate` 與 `SyncRun` 用來追蹤同步狀態。
- `Series.nextReleaseDate` 依 country + indicator 發布規則推算，支援 `COUNTRY_INDICATOR_RELEASE_DATES` 環境變數覆寫確切日期。
- `DataProvider` 記錄 provider priority、API key 需求與覆蓋狀態。
- 寫入前需正規化日期、頻率、單位與國家代碼。
- 若官方資料需要 API key 或付費授權，先以文件記錄，不在首版骨架硬接。

## 中國 NBS 資料

- `NBS_DIRECT_ENABLED=false` 時只使用 DBnomics 鏡像；設為 `true` 後優先呼叫 `https://data.stats.gov.cn/easyquery.htm`，並以 `NBS_DIRECT_TIMEOUT_MS` 控制 timeout。直連失敗不會中斷鏡像同步。
- 中國 CPI 指標碼具有有效期間：`2016-2020` 使用 `M_A010101/A01010101`、`2021-2025` 使用 `M_A01010G/A01010G01`、`2026+` 使用 `M_A01010J/A01010J01`。
- NBS CPI 回傳「上年同月 = 100」指數，寫入前減去 `100`，統一顯示為 YoY `%`。
- 同一期資料依 `NBS EasyQuery direct > DBnomics NBS mirror > DBnomics IMF fallback` 合併，並保留每筆 observation 的實際來源。
