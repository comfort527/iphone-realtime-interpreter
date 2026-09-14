# iPhone 即時口譯 PWA — 第一版

TypeScript + Vite + 原生 Web Audio / AudioWorklet，Node.js 同源後端。Mock 不需要 API 金鑰；OpenAI Realtime 與 Gemini Live 使用伺服器 WebSocket 代理，前端不接觸永久金鑰。原始三份規格保存在 `spec/`。

## iPhone 直接開啟

[GitHub Pages Mock 展示版](https://comfort527.github.io/iphone-realtime-interpreter/)

用 iPhone Safari 開啟，分享 → 加入主畫面。網站使用 HTTPS；取消「純展示」即可測試麥克風。GitHub Pages 只提供靜態前端，OpenAI／Gemini 選項在此版本停用，正式代理仍需依下方步驟部署 Node 伺服器。私人繁中仍只顯示字幕，不會 fallback 到 Speaker。

`.github/workflows/pages.yml` 在每次 main 更新時執行核心測試與 TypeScript 建置，再發佈 Pages。建置使用 `VITE_STATIC_DEMO=true` 與儲存庫子路徑，不將金鑰放入 Actions 或前端。

## 啟動

需求：Node.js 22.13 以上（建議 24）、pnpm 11；也可使用 npm。

```sh
pnpm install
pnpm dev
# 瀏覽 http://localhost:5173
```

使用 npm 時：`npm install`、`npm run dev`。正式建置：

```sh
pnpm build
pnpm start
```

`dev` 同時提供 Vite 與 `/api/*`，不用啟動第二台伺服器。正式版從 `dist/` 提供 PWA；Service Worker 僅在正式建置註冊。

## Mock 驗收

主畫面僅保留狀態、雙向字幕與開始／停止。點上方「設定」可調整語言、引擎和輸出；下方「試用範例」提供雙向 Mock 按鈕，「更多測試」提供低信心、路由中斷和無聲耳機模擬。

1. 保持 Mock 與「純展示」勾選，按「開始口譯」。不需要麥克風也能跑完整事件流。
2. 勾選「模擬耳機播放生命週期（全程無聲）」，按「對方說外語」：`LISTENING → PROCESSING → AIRPODS_PLAYING → LISTENING`，同步顯示原文／繁中。模擬使用全零 PCM 的真實 Web Audio 播放生命週期，不是私人語音。
3. 將系統音訊輸出切到手機喇叭，勾選公開輸出，按「我說中文」：`PROCESSING → SPEAKER_PLAYING → COOLDOWN → LISTENING`。Mock 使用系統 TTS，依選定外語發音；沒有可用 TTS 或權限時明確顯示 ERROR。
4. 使用 `/?debug=1` 開啟診斷面板。在播放與冷卻期間按「注入麥克風事件」：`blocked` 增加，`uploadedBytes` 不增加。生產音訊回呼與此按鈕經過同一個入口 Gate。
5. 按「低信心輸入」：顯示提示、不播放；按「模擬耳機中斷」：取消播放與上傳，停在 ROUTE_LOST。重新開始後，繁中仍靜音。
6. 播放期間按停止，等待一秒以上：應保持 IDLE，不會被舊回呼恢復。
7. 要驗證實際麥克風，停止後取消「純展示」，再開始並允許麥克風。VAD 收到短句會觸發固定 Mock 範例；Mock 不辨識真實語意。

## 接 OpenAI Realtime，再接 Gemini Live

複製 `.env.example` 為 `.env`，填入自己的金鑰後重啟伺服器：

```dotenv
OPENAI_API_KEY=你的伺服器金鑰
GEMINI_API_KEY=你的伺服器金鑰
OPENAI_MODEL=gpt-realtime
GEMINI_MODEL=gemini-3.1-flash-live-preview
```

先選 OpenAI，再選 Gemini，逐項重跑 `spec/TEST_PLAN.md`。沒有設定金鑰時端點回傳明確的 503，不會偷偷切換 Mock。模型名稱可依帳號可用模型調整。

- `POST /api/session/openai`、`POST /api/session/gemini`：檢查設定與語言，發放 30 秒有效、一次性、256-bit 隨機代理 ticket。
- 前端在同源 `/api/live` WebSocket 的第一則訊息傳 ticket。後端才使用永久金鑰連接上游；ticket 不放 URL。
- OpenAI：GA `session.update`、PCM16 24 kHz、停用上游 VAD、自行 commit/create response；合併輸入轉錄、輸出轉錄與 PCM，等待二者完成再交給播放器。
- Gemini：Live setup、手動 activityStart/activityEnd、24 kHz PCM 與輸入／輸出轉錄。收到 turnComplete 才釋放結果。
- 限制單段 10 秒、每個瀏覽器一個在途翻譯、最多 4 個代理連線、每個 session 10 分鐘；逾時與 provider 錯誤會顯示，釋放音訊資源。
- 上游音訊僅暫存記憶體，不落磁碟、不記錄原文或 API 金鑰。前端字幕只使用 `textContent`。

## 不變的安全規則

**私人繁中不得 fallback 到 Speaker。** 這個純網頁版本一律不播放真實私人繁中音訊。裝置名稱、`setSinkId` 成功、使用者勾選都不足以保證耳機拔除時的原子靜音，因此不作為解鎖條件。AIRPODS_PLAYING 僅用於明確標示的全零 PCM 模擬。真正耳機語音需要原生音訊橋接，在 OS 路由層保證失去私人路由時立即截斷；目前未實作原生橋接。

**Speaker Gate + 400 ms COOLDOWN。** 麥克風 session 可以保持開啟，但只有 LISTENING 可做 VAD 或上傳。PROCESSING 也關閉 Gate，避免播放等待或 TTS 權限期間漏送。播放以 AudioBufferSource.start/onended 或 TTS onstart/onend 驅動；不是用音訊下載完成時間計算冷卻。停止／背景／失去路由會取消播放和計時器，舊 generation 不得恢復狀態。

**Playback reference。** 最近 5 秒、最多 8 筆 metadata／可選 PCM buffer，只有 1.5 秒內、reference ID 一致、相關性 >= 0.92 且正規化文字相同時，才視為回音候選。尚未提供音訊 correlation engine，預設不做第二層丟棄，主要靠 Gate + COOLDOWN。聲紋與 AEC 強化屬後續擴充；瀏覽器內建 echoCancellation 已要求啟用。

**公開外語輸出。** Safari 無法可靠指定內建喇叭；使用者需先在系統切換輸出並勾選。勾選只允許外語走目前系統輸出，並不宣稱可自動切換 iPhone Speaker。裝置變更時取消勾選並停止 session。

## 第一版的語言判定與延遲

使用本機能量 VAD（550 ms 靜音收段、180 ms 最短有效語音、10 秒上限），經 Gate 後把短句 PCM 交給 Provider。模型依指定兩語互譯；後端再用原文／譯文字形與外語常見詞作保守方向驗證。分數 0.85／0.25 是啟發式結果，不是校準後的模型信心。無法明確區分時不播放。

此版本尚無本地語音語言模型，因此方向判定依賴 Provider 轉錄，發生在音訊上傳後、結果釋放前；Gate 則確實位於 VAD 與任何 API 上傳之前。日文純漢字、只有姓名／數字、短單字、混合語言或缺少常見詞的句子可能被判低信心。這些品質限制需要用實際錄音語料再改進，未宣稱支援任意語言辨識。

雖然使用 Realtime/Live 連線，MVP 刻意採「短句收完 → 翻譯完成 → 播放」，不做 full-duplex、逐 token 即播或插話。這能在方向未驗證前保留音訊，代價是較高延遲。耳機模擬／翻譯期間也暫停新段落。

## iPhone / HTTPS / PWA

桌面用 `localhost`。iPhone 不可使用一般 LAN HTTP 取得麥克風，請在自己的環境使用可信任 HTTPS 反向代理，設定：

```dotenv
HOST=0.0.0.0
APP_ORIGIN=https://你的可信任網域
APP_PASSWORD=自行設定的強密碼
```

代理必須轉送 WebSocket upgrade 並保留公開 Host／Origin，前端輸入同一個伺服器密碼。非 loopback 綁定必須設定密碼；程式未替你部署或開放防火牆。

Safari → 分享 → 加入主畫面。包含 manifest、192/512 PNG placeholder 圖示、apple-touch-icon、safe-area 與離線 shell。首次在線安裝快取完成後可離線開啟 Mock；API 請求、密碼與對話不進 Service Worker 快取。系統 TTS 是否離線可用取決於裝置語音。

背景／鎖屏／pagehide 立即釋放 mic、停止播放並進 INTERRUPTED；回前景需按重新開始，重新取得 mic、網路與 Provider。網路中斷停止上傳，最多重試 3 次（1/2/4 秒）；自動重啟若被音訊政策拒絕，改由使用者手動開始。裝置變更採保守 ROUTE_LOST。

## 測試

```sh
pnpm test
pnpm build
pnpm start
# 另一個終端機；需要已安裝 Microsoft Edge
pnpm test:browser
# 後端錯誤與離線 PWA 測試（在未填金鑰的環境執行）
node tests/server-browser.mjs
```

核心與 Provider 測試不需要 API。瀏覽器測試以 Edge 手機尺寸執行，TTS 回呼使用可重現的測試替身，私人模擬使用真實 Web Audio 全零 PCM。這不等於 iPhone 實機聲音驗收。測試結果與尚待驗證項目見 `TEST_RESULTS.md`；瀏覽器截圖在 `test-results/mobile.png`。

## 官方協定參考

- [OpenAI Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [OpenAI WebSockets](https://developers.openai.com/api/docs/guides/voice-websockets)
- [Gemini Live WebSockets](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket)
- [Gemini Live API reference](https://ai.google.dev/api/live)

已依官方文件實作，但本次沒有真實 API 憑證，尚未進行付費端到端呼叫，也未執行 iPhone／AirPods 實機測試。
