# 給 Codex / Astra 的主提示詞

你現在要完成一個「iPhone Safari / PWA 雙向即時口譯器」的 MVP。請直接在此 repo 內實作，不要只提出建議。

## 技術目標

使用 TypeScript + Vite + 原生 Web API（必要時可引入小型可靠套件），建立可在 iPhone Safari 使用並可加入主畫面的 PWA。

## 使用情境

使用者戴 AirPods，iPhone 放在桌面：

A. 對方說指定外語（例如英文）
- iPhone 麥克風收音
- AI 即時翻譯為台灣繁體中文
- 中文譯音優先送耳機
- 畫面同步顯示原文與繁中字幕

B. 使用者說中文
- iPhone 麥克風收音
- AI 翻譯成指定外語
- 外語譯音由 iPhone Speaker 播放給對方
- 畫面同步顯示中文原文與外語譯文

## 最重要的防重複規則

1. 當 iPhone Speaker 正在播放「中文→外語」譯音時：
   - 麥克風 session 可以保持開啟。
   - 但必須暫停 VAD 後的語言判定、暫停送 AI、暫停觸發新翻譯。
2. Speaker 播放結束後進入 COOLDOWN 狀態 300–500 ms，再恢復 LISTENING。
3. 保存最近 3–5 秒的 playback reference / 最近播出的文字，作為殘響重複抑制的第二層防線。
4. 不可只靠「文字相同就丟掉」；避免誤殺對方真的重複相同句子的情況。
5. 第一版以 Speaker Gate 為主，AEC / audio correlation 可留 extension point。

## 狀態機

至少包含：

- IDLE
- REQUESTING_PERMISSION
- LISTENING
- PROCESSING
- AIRPODS_PLAYING
- SPEAKER_PLAYING
- COOLDOWN
- NETWORK_LOST
- ROUTE_LOST
- INTERRUPTED
- ERROR

狀態轉移要集中管理，禁止散落大量互相衝突的 boolean。

## 語言判斷

第一版不用做 70 種語言自動辨識。

設定：
- 我的語言固定：繁體中文（台灣）
- 對方語言：使用者從設定選單指定

語音段落只需判斷：
- 中文
- 指定外語
- 不確定

若不確定，不要硬翻；在 UI 顯示低信心狀態。

## Provider abstraction

建立統一 interface，例如：

```ts
interface RealtimeTranslationProvider {
  connect(config: ProviderConfig): Promise<void>
  disconnect(): Promise<void>
  pushAudio(chunk: ArrayBuffer): void
  setDirection(direction: 'foreign-to-zh' | 'zh-to-foreign'): void
  onTranscript(cb: (event: TranscriptEvent) => void): () => void
  onAudio(cb: (event: AudioOutputEvent) => void): () => void
  onStatus(cb: (status: ProviderStatus) => void): () => void
}
```

至少建立：
- OpenAIRealtimeProvider
- GeminiLiveProvider

若目前缺 API credential，provider 可以先以 mock adapter 運作，但介面、生命週期與事件流要做完整。

## API 安全

前端不可硬寫永久 API Key。

建立 `server/`：
- `/api/session/openai`
- `/api/session/gemini`

先使用 stub / env 變數，並在 README 說明如何填入。

## 音訊需求

- getUserMedia 取得 mic。
- 建立 AudioContext / AudioWorklet 或合理的 streaming audio pipeline。
- 麥克風與播放 pipeline 分離。
- Speaker Gate 必須由實際 playback state 驅動。
- WebKit 不支援的輸出路由能力需 graceful degradation。
- 若偵測不到耳機或輸出 route 無法確認，繁中私人譯音不要自動改由手機 Speaker 播放。

## UI

手機優先、極簡：

- 我的語言：繁體中文（固定）
- 對方語言：選單
- Provider：OpenAI / Gemini
- 大型 Start / Stop
- 目前狀態：正在聽 / 正在翻譯 / 手機正在播外語 / 冷卻 / 網路中斷
- 對方原文
- 繁中譯文
- 我的中文
- 將播放的外語
- 耳機狀態 / 安全提示
- debug panel 可透過 query string 或設定開啟

## 失敗保護

- AirPods/耳機 route 消失：私人中文譯音立刻 mute；顯示 ROUTE_LOST。
- 網路斷線：停止上傳，顯示 NETWORK_LOST，自動有限次重連。
- App/page background：不要假裝仍在正常翻譯；恢復前重新檢查 mic、network、provider。
- 禁止產生 silent failure。

## PWA

需要：
- manifest.webmanifest
- service worker
- viewport / safe-area
- installable icon placeholder
- iOS Safari meta tags

## 驗收條件

至少用 mock provider 可以完整展示：

1. LISTENING 收到「外語」mock input。
2. 產生繁中字幕與 AIRPODS_PLAYING。
3. LISTENING 收到「中文」mock input。
4. 進入 PROCESSING → SPEAKER_PLAYING。
5. SPEAKER_PLAYING 期間 mic event 不會進 provider。
6. 播完進 COOLDOWN 400 ms。
7. 回到 LISTENING。
8. route lost 時私人譯音不會從 Speaker 播出。
9. 所有主要狀態都有 UI 顯示。

請直接完成可執行版本，並補上 README 的啟動與測試步驟。
