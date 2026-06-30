## Plan: 建立歐盟、東亞與美國經濟數據追蹤網站

TL;DR - 目標：打造一個彙整並視覺化歐盟、東亞與美國主要經濟指標（如 GDP、CPI、失業率、匯率、利率、主要股指）的網站；方法：後端定期抓取多個公開資料來源、儲存於時序資料庫或 PostgreSQL、提供 API；前端使用 React/TypeScript 建儀表板與互動圖表。

已確認的偏好（來自使用者回覆）
- 技術棧：前端 React + TypeScript，後端 Node.js（Express）
- 核心指標（首版）：GDP（名目/實質）、CPI / 物價指數、利率（政策利率、長短期利率）
- 更新頻率：混合（依指標而定）
- 使用者與授權：公開讀取（不需登入）
- 語言：繁體中文、英文
- 預算註記：優先以免費、官方資料來源為主；若需要付費 API 再討論

Steps
1. 需求驗證：已確認技術棧與首版指標，接下來確認?. 需求驗證：已確認技術棧些成員國？東亞哪些國家？）。
2. 設計資料源與取得策略：為每個指標指派優先來源（例如：GDP -> World Bank / OECD / Eurostat；利率 -> 各央行或 FRED），標註授權與認證需求。
3. 建立專案骨架：初始化前端（React+TS）與後端（Node+Express），建立 repo 結構、ESLint/Prettier 與 CI。
4. 資料管線實作：撰寫 ETL/同步 worker，用 cron/排程抓取、正規化資料、寫入 PostgreSQL（未來可升級 TimescaleDB）。
5. 快取與效能：加入 Redis 快取熱門查詢，API 分頁與分層快取策略。
6. API 設計：以 REST 提供資料接口（公開讀取），設計合理的查詢參數與版本控制。
7. 前端視覺化：實作儀表板、時間序列圖、比較視圖與區域篩選器，使用 Plotly 或 ECharts。
8. 測試與 CI/CD：後端單元測試、前端整合測試、資料 pipeline 驗證；自動化部署到 Vercel（前端）與 Render/Railway（後端）。
9. 上線與監控：設定錯誤追蹤、資料品質告警（缺失/延遲）、使用指標監控。

Relevant files (建議)
- frontend/ — React 前端程式碼、頁面、圖表組件
- backend/ — Node/Express API、資料抓取 worker、轉換腳本
- infra/ — Dockerfile、deploy scripts
- db/ — 資料模型與遷移腳本
- scripts/ — 定期排程與測試工具
- README.md — 專案說明與資料來源清單

Verification
1. 後端：對每個資料來源建立 mock 測試與端點回歸測試
2. 前端：儀表板載入測試與主要互動（選區間、比較國家）驗收
3. 資料品質：排程成功率、資料延遲報表、比對原始來源的 sample checks
4. 部署：自動化部署成功率、健康檢查 endpoint 回應

Decisions / 假設
- 優先採用公開且穩定的 API（例如 FRED、World Bank、Eurostat）以降低成本
- 首版以 PostgreSQL + Redis 作為主 DB 與快取；若需要高效時序分析，可考慮 TimescaleDB 或 InfluxDB
- 視覺化以 React + Plotly/ECharts 為主，兼顧互動性與開發速度

Further Considerations
1. 資料授權與使用限制（商用/非商用）需逐一核對
2. 多語系與在地化（繁體/英文）優先順序
3. 若需實時金融數據或高頻交易資料，可能要預算付費資料源

Initialize 專案骨架（要求 A） — 可執行計畫

TL;DR：建立一個乾淨、可本地開發與 CI 的 monorepo skeleton，包含 frontend（React+TypeScript）、backend（Node+Express+TypeScript）、db（遷移腳本）、infra（Dockerfile, docker-compose）、以及 CI workflow；以便後續快速實作 ETL 與視覺化功能。

Steps
1. 建立 repo 結構：frontend/, backend/, db/, infra/, scripts/, docs/。
2. 前端初始化：使用 Vite + React + TypeScript 建專案骨架，加入 ESLint、Prettier、基本路由（/、/dashboard）、i18n 初步配置（繁體/英文）。
3. 後端初始化：建立 Node.js + TypeScript 專案，加入 Express、dotenv、Prisma（建議）、基本 routes：/api/health, /api/v1/indicators，以及 worker/ 目錄放排程抓取腳本範例。
4. 資料庫腳手架：撰寫初始 schema（countries, indicators, series, observations），並建立遷移範本。
5. Docker 與本地啟動：為 frontend/backend 寫 Dockerfile，提供 infra/docker-compose.yml 用於本地 Postgres + Redis + app 啟動。
6. CI/CD：建立 GitHub Actions workflow（lint + test + build），並加入 basic deploy job 範例（可禁用）。
7. 文件與範例：撰寫 README.md（如何啟動、本地測試、資料來源列表）、CONTRIBUTING.md 與 LICENSE。

Verification
1. 本地啟動：前端與後端能以開發模式啟動，健康檢查 GET /api/health 回傳 200
2. DB 初始化：執行遷移後 countries、indicators table 存在
3. ETL 範例：執行 worker/fetch_sample.ts 能向公共 API 取回測試資料並寫入 observations（用 mock 或免費 API）
4. CI：PR 觸發 lint 與 build workflow 成功（可在草案中測試）

估計工時（粗略）
- 初始化骨架（含 Docker、CI、README）：約 4–8 小時
- 加入基本 ETL 範例並測試：另需 2–4 小時

決策 / 假設
- 使用者偏好 React+TS 與 Node.js/Express（已確認）
- 初期資料來源以免費公開 API 為主，ETL 範例將以 World Bank 或 FRED 的公開指標作示範
- ORM 建議使用 Prisma（TypeScript 友好）
