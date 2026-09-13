# 第一版驗證紀錄

驗證日期：2026-09-13。環境：Windows、Node.js 24.19.0、TypeScript 5.9.3、Vite 7.3.6、Playwright 1.63.0、桌面 Microsoft Edge（390 × 844 手機 viewport）。

## 已執行並通過

| 項目 | 結果與範圍 |
| --- | --- |
| TypeScript / 正式建置 | `tsc`、`vite build` 成功；JS 約 20.6 kB，gzip 約 8.4 kB |
| 核心與 Provider 協定 | 15 / 15 通過，`node --experimental-transform-types --test tests/*.test.ts` |
| Mock 瀏覽器流程 | `node tests/browser.mjs` 通過：双向字幕、無聲耳機模擬、公開播放、Gate、COOLDOWN、低信心、路由中斷、停止、離線、mic 權限拒絕、手機寬度無溢出 |
| 後端與 PWA | `node tests/server-browser.mjs` 通過：兩種金鑰缺失 503、no-store、AudioWorklet 搭配瀏覽器模擬 mic、離線 shell、離線 Mock |
| 視覺檢查 | 已檢視 `test-results/mobile.png`，字幕、設定、按鈕與 debug 面板無裁切／水平溢出 |
| GitHub Pages 子路徑 | `node tests/pages-browser.mjs` 通過：子路徑 assets、AudioWorklet、相對 manifest、停用遠端 Provider、離線 Mock |

15 項核心／協定測試包括：合法狀態轉移、播放實際完成後 400 ms、停止取消、冷卻中路由中斷、快速 Stop/Start 殘響防線、播放拒絕不開 Gate、純文字重複不丟棄與 reference 到期、VAD、Mock 配對與取消、保守語言驗證、上游 VAD 設定、OpenAI 晚到輸入轉錄、Gemini activity/轉錄/PCM、低信心音訊阻擋、上游關閉後過期事件。

## 測試替身與限制

- 瀏覽器公開 TTS 使用可重現的 onstart/onend 測試替身；不是對實際 Speaker 音質或裝置路由的驗證。
- 私人模擬使用全零 PCM 的真實 Web Audio 播放，沒有把繁中語音送到喇叭。
- 協定測試使用事件 fixture 與替身 WebSocket，不連接 OpenAI／Google、不產生 API 費用。
- 第二組瀏覽器測試的麥克風是 Edge fake media device；驗證 AudioWorklet 圖與生命週期，未驗證實體 iPhone 麥克風。

## 尚未驗證／未實作能力

- 沒有 API 憑證：未做 OpenAI Realtime 或 Gemini Live 真實端到端呼叫，模型權限、額度、實際音訊與轉錄品質待驗證。
- 沒有 iPhone／AirPods 實機：Safari 麥克風權限、加入主畫面、Siri／來電、鎖屏、Wi-Fi／5G 切換、長時間穩定性仍依 `spec/TEST_PLAN.md` 實測。
- 私人耳機真實譯音在此純網頁版本維持禁用；原生安全 route bridge 尚未實作。
- 未保證 Safari 自動切換內建 Speaker／AirPods；公開輸出須手動切系統路由。
- 語言分類是保守啟發式，日文純漢字、數字姓名或缺少標記詞的句子可能低信心。未完成品質語料評估。
- 音訊 correlation、聲紋、強化 AEC、full-duplex/barge-in 未實作。第二層回音抑制只提供需證據的介面，未捏造 correlation 分數。

保留原始 `spec/TEST_PLAN.md` 的未勾選清單，避免把桌面模擬測試誤寫成 iPhone 驗收完成。
