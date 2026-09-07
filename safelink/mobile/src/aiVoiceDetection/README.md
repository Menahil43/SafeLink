# AI Voice Detection (FR-28)

Continuous, on-device listening that detects **distress keywords** ("help", "bachao",
"save me", …) and **screams / high-volume vocalizations**, scores a real confidence
level, and routes confirmed/high-confidence distress to the app's **existing** Emergency
Engine. It never creates its own SOS, contacts, notification, or location system, and
**manual SOS keeps working even if this module fails or is unavailable.**

This module is self-contained under `src/aiVoiceDetection/`. To remove the feature,
delete the folder and revert the four small integration edits listed below.

---

## 1. Files created / modified

### Created — the module (`mobile/src/aiVoiceDetection/`)

| File | What it does |
| --- | --- |
| `types.ts` | Shared types (`DetectionResult`, `RiskLevel`, `AiVoiceStatus`, `ActiveAlert`, `AiVoiceConfig`, …). Detection types/actions mirror the backend. |
| `config.ts` | Resolves effective config from the signed-in user's saved `aiSettings` / `emergencyPreferences` with safe defaults. `riskFromConfidence()` mirrors the server's confidence→risk mapping. Reads optional `EXPO_PUBLIC_AI_VOICE_LANG`. |
| `detection/keywordMatcher.ts` | Pure, testable distress-phrase matcher. Blends **recognizer confidence × match quality × per-keyword severity** into a 0–100 score. Spelling/accent tolerant (handles "bachao/bachaoo/bachau"). Not a fixed trigger. |
| `detection/acousticAnalyzer.ts` | Rolling loudness-envelope analyzer over `volumechange` samples → scream/shout confidence. Pluggable `AcousticClassifier` interface; default `HeuristicClassifier` (loudness + sustain + dynamic-range). Reports `available:false` honestly when no metering. |
| `detection/fusion.ts` | Fuses keyword + acoustic channels into one `DetectionResult`. Corroboration boosts confidence; **acoustic-only is capped at 74** so loudness alone never auto-SOSes. |
| `detection/speechAdapter.ts` | Thin wrapper around `expo-speech-recognition` via **optional-require** (missing native module never crashes the app). Continuous recognition + interim results + volume stream on a single mic. |
| `aiVoiceStore.ts` | Module-local zustand store (status, mic level, transcript, active alert, in-memory log). Kept separate from the global store for isolation. |
| `AiVoiceDetectionController.ts` | Singleton orchestrator. Owns the detection lifecycle across screens, runs the FR-28 state machine, applies cooldown/debounce, drives the alert + countdown, and calls `emergencyEngine.activate({ source: 'AI_DETECTION' })`. Duplicate-SOS guarded; recognizer self-heals on end/error. |
| `useAiVoiceDetection.ts` | React hook exposing store state + controller actions. |
| `components/DistressAlertOverlay.tsx` | The alert surface (RN Modal). HIGH → "Possible Distress Detected" + countdown + "I'm Safe / Cancel"; MEDIUM → soft warning, never auto-SOS. |
| `screens/AiVoiceDetectionScreen.tsx` | The control screen behind the Home "AI Detection" card: arm/disarm, live status + mic meter, editable keywords/sensitivity (persisted via the existing `/ai/settings` API), recent-detections log. |
| `index.ts` | Public module surface (single import path). |

### Modified — integration (4 edits, minimal)

| File | Change |
| --- | --- |
| `mobile/src/screens/HomeScreen.tsx` | AI Detection card `onPress`: `comingSoon('AI Detection')` → `onNavigate('aiVoice')`. |
| `mobile/App.tsx` | Import the module; add the `aiVoice` full-screen route; mount `<DistressAlertOverlay/>` once at the root; start the controller on login if the user had it enabled, stop it on logout. |
| `mobile/app.json` | Add the `expo-speech-recognition` config plugin + iOS `NSMicrophoneUsageDescription` / `NSSpeechRecognitionUsageDescription` + Android `RECORD_AUDIO`. |
| `mobile/package.json` | Add dependency `expo-speech-recognition`. |
| `mobile/.env.example` | Document optional `EXPO_PUBLIC_AI_VOICE_LANG`. |

**Backend:** no changes. The existing `POST /ai/detection`, `PUT /ai/detection/:id/respond`,
`GET/PUT /ai/settings`, and `emergency` endpoints are reused as-is.

---

## 2. How the existing button connects to the module

1. Home's **AI Detection** card now calls `onNavigate('aiVoice')`.
2. `App.tsx` intercepts `'aiVoice'` and renders `AiVoiceDetectionScreen` full-screen.
3. The screen calls `useAiVoiceDetection().toggle()` → `aiVoiceController.enable()/disable()`.
4. `enable()` requests mic/speech permission and starts continuous recognition.
   `result` events feed the keyword matcher; `volumechange` events feed the acoustic
   analyzer. The two are fused into a confidence + risk level.
5. On a HIGH-confidence detection the controller sets `activeAlert`; the globally-mounted
   `DistressAlertOverlay` shows it over any screen with a countdown. If the user does
   nothing, the countdown calls `emergencyEngine.activate({ source: 'AI_DETECTION' })` —
   the **same** engine the manual SOS button uses. MEDIUM detections warn only.
6. Every detection is logged through the existing `aiAPI.logDetection`; the user's
   response (SOS/cancel) through `aiAPI.respondToDetection`.

---

## 3. Detection flow (state machine)

```
OFF → STARTING → LISTENING ⇄ DETECTING → EVALUATING
                                   │
             confidence ≥ auto (75)│──► ALERTING (HIGH) ──countdown──► ESCALATING ─► existing SOS
             confidence ≥ warn (50)│──► ALERTING (MEDIUM, user confirms only)
             below warn            │──► logged as IGNORED, keep LISTENING
                                   └──► COOLDOWN (anti-spam) after any alert
```

Confidence → risk (matches backend): ≥90 CRITICAL, ≥75 HIGH, ≥50 MEDIUM, else LOW.

Safeguards: per-detection cooldown (`alertCooldownMs`, 20s), escalation guard against
duplicate SOS, `canAlert()` suppresses new alerts while an emergency is active/activating,
and all native calls are wrapped so a detection failure never blocks manual SOS.

---

## 4. Environment / API keys / model setup

- **No API key required** for the default configuration. Detection runs on-device via the
  OS speech recognizer + a loudness heuristic.
- **Optional** `EXPO_PUBLIC_AI_VOICE_LANG` (in `.env`) sets the recognizer locale, e.g.
  `en-US` (default), `en-IN`, `ur-PK`. Affects keyword detection only; scream detection is
  language-independent.
- **User-tunable settings** (persisted through `PUT /ai/settings`, no code change):
  keyword list, auto-SOS sensitivity threshold, and scream-detection on/off — all editable
  from the AI Voice Detection screen.
- **Upgrading scream detection to a real ML model (optional):** loudness alone can't fully
  distinguish a scream from constant-loud music, so by default a scream raises a MEDIUM
  warning (never a silent auto-SOS). To enable higher-confidence acoustic auto-SOS, drop in
  an audio classifier (e.g. YAMNet / a TFLite model, or a cloud audio-classification API) by
  implementing the `AcousticClassifier` interface in `detection/acousticAnalyzer.ts` and
  calling `analyzer.setClassifier(yourClassifier)` — no other module code changes.

---

## 5. Run & test

### Install
```bash
cd mobile
npm install
```

### Native module requires a development build (NOT Expo Go / web)
`expo-speech-recognition` is a native module, so the mic/keyword/scream features run only
in a custom dev client. In Expo Go or web the screen shows an honest "development build
required" state and **manual SOS still works**.

```bash
# One-time: create a dev build
npx expo prebuild
npx expo run:android      # or: npx expo run:ios   (device recommended for a real mic)
```

### Typecheck (already passing)
```bash
cd mobile && npx tsc --noEmit
```

### Functional test matrix
Open **Home → AI Detection → toggle "Continuous listening" on**, grant permission, then:

| Say / do | Expected |
| --- | --- |
| "Help", "Save me", "Bachao", "Bachaoo" | HIGH alert + countdown → auto-SOS if you don't cancel |
| "Bachau" (mispronounced) | Fuzzy-matched, still HIGH |
| "Stop" (alone) | MEDIUM warning, **no** auto-SOS |
| Scream / shout | MEDIUM warning (scream) — confirm to SOS |
| Scream **while** saying "help" | COMBINED, CRITICAL → auto-SOS |
| Normal conversation | No alert (logged as ignored) |
| Background noise / quiet | No alert |
| Loud music at constant volume | At most a MEDIUM warning, **never** auto-SOS |
| Tap "I'm Safe / Cancel" during countdown | SOS cancelled, logged as CANCELLED |
| Trigger twice quickly | Second suppressed by cooldown |
| Manual SOS with detection ON, OFF, and unavailable | Always works |

The pure detection logic (keyword matcher, acoustic analyzer, fusion, risk mapping) is
verified by an automated harness covering all rows above; every case passes.
