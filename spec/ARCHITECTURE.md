# 架構說明

## 1. 系統層次

```text
Mic
 ↓
Capture Pipeline
 ↓
Speaker Gate ─── Speaker Playback State
 ↓
VAD / Segmenter
 ↓
Direction Classifier
 ↓
Provider Adapter (OpenAI / Gemini)
 ↓
┌─────────────────────┬─────────────────────┐
│ foreign → zh-TW     │ zh-TW → foreign     │
│                     │                     │
│ transcript + audio  │ transcript + audio  │
│       ↓             │       ↓             │
│ headphones/private  │ iPhone speaker      │
└─────────────────────┴─────────────────────┘
```

## 2. 防止自己翻自己的優先順序

### Level 1 — Speaker Gate
只要手機 Speaker 正在播「中文→外語」譯音，停止 VAD 後的所有判斷與 API 上傳。

### Level 2 — Cooldown
Speaker 結束後等待 300–500ms，避免房間殘響被當成新語音。

### Level 3 — Playback Reference
保存最近播放音訊的 reference metadata / buffer extension point。

### Level 4 — Recent Transcript Suppression
只有在「時間非常接近 + 播放 reference 相符 + 文字高度相似」時才視為回音候選。

## 3. 狀態機

```text
IDLE
 ↓ start
REQUESTING_PERMISSION
 ↓ ok
LISTENING
 ├─ foreign segment → PROCESSING → AIRPODS_PLAYING → LISTENING
 └─ zh segment      → PROCESSING → SPEAKER_PLAYING → COOLDOWN → LISTENING

任何狀態：
- network failure → NETWORK_LOST
- private route loss → ROUTE_LOST
- interruption → INTERRUPTED
- fatal error → ERROR
```

## 4. 隱私輸出規則

繁中譯音視為私人輸出：
- 有耳機 route → 可播放。
- route 不明或耳機中斷 → mute，不可 fallback 到 speaker。

外語譯音視為公開輸出：
- 由手機 Speaker 播放。

## 5. 第一版限制

- 不要求真正 full-duplex barge-in。
- Speaker 播放時，對方若插話可能漏收；這是第一版刻意接受的 trade-off。
- 不做聲紋辨識；預留 speaker verification hook。
- 不保證 Safari 可精準指定 AirPods / built-in speaker 雙路輸出；先做能力偵測與 graceful degradation。

## 6. 第二階段

- 原生 Swift audio bridge / Capacitor plugin。
- AVAudioSession / AVAudioEngine dualRoute/multiRoute。
- AEC 強化。
- speaker verification。
- barge-in。
- playback audio correlation。
