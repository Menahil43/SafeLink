# SafeLink — Complete Technical & Feature Report

> Scope: end-to-end audit of the repository at `C:\Users\Hp\Desktop\safelink 1.2\safelink`.
> Every claim below is cross-referenced against a specific file and line range in the
> mobile app, the Express backend, or the native Android module. No documentation file
> or README has been taken at face value; only the source code is the source of truth.
>
> Verification status legend used throughout this report:
> - ✅ **Verified** — code path exists, compiles, and was confirmed in the latest
>   physical-device test (mobile TS clean, backend TS clean, `./gradlew assembleDebug`
>   BUILD SUCCESSFUL on JDK 17, native recorder reaches `startRecording` and emits
>   `bytesWritten > 0` per the most recent physical-device Logcat trace).
> - 🟡 **Partial** — implemented but not exercised end-to-end on hardware in this audit.
> - ⚪ **Not implemented** — file/endpoint exists as a stub or has no current consumer.
> - 🚫 **Not used** — dependency/configuration present but not wired into the running flow.
>
> Last audit: 2026-09-03.

---

## Table of contents

1. [Project overview](#1-project-overview)
2. [Technology stack](#2-technology-stack)
3. [Complete feature inventory](#3-complete-feature-inventory)
4. [SafeLink SOS flow](#4-safelink-sos-flow)
5. [Recording system — very detailed](#5-recording-system--very-detailed)
6. [Database architecture](#6-database-architecture)
7. [Backend API documentation](#7-backend-api-documentation)
8. [Mobile application architecture](#8-mobile-application-architecture)
9. [Native Android architecture](#9-native-android-architecture)
10. [Firebase integration](#10-firebase-integration)
11. [Location & map system](#11-location--map-system)
12. [Notification system](#12-notification-system)
13. [Safety Timer](#13-safety-timer)
14. [AI / voice distress detection](#14-ai--voice-distress-detection)
15. [Security](#15-security)
16. [Environment variables & configuration](#16-environment-variables--configuration)
17. [Running the project](#17-running-the-project)
18. [Testing status](#18-testing-status)
19. [Currently working features (verified)](#19-currently-working-features-verified)
20. [Current limitations / known issues](#20-current-limitations--known-issues)
21. [Cloud vs local architecture](#21-cloud-vs-local-architecture)
22. [File/folder architecture](#22-filefolder-architecture)
23. [Important code flows](#23-important-code-flows)
24. [Hackathon demo readiness](#24-hackathon-demo-readiness)
25. [Final executive summary](#25-final-executive-summary)
26. [Appendix](#26-appendix)

---

## 1. Project overview

**What SafeLink is.** A cross-platform personal-safety app (Expo SDK 54 / React Native
0.81.5) that runs as an Expo **development build** on Android, backed by a Node.js +
Express + MongoDB server, authenticated through Firebase, and augmented with a small
amount of custom Java code on the Android side for guaranteed microphone capture.

**Main purpose.** When a user feels unsafe, the app must (a) get a real emergency on
the record on the server, (b) alert the user's trusted contacts, (c) keep streaming
live GPS to the backend, (d) record microphone audio as evidence, and (e) let the user
or a Safety Timer escalate to an emergency automatically.

**Problem solved.** Most "panic button" apps fail at three points: notification
delivery, background audio capture, and idempotency (double-taps and app restarts
creating duplicate emergencies). SafeLink routes every trigger — manual SOS, AI
detection, Safety Timer, future IoT band — through a single backend Emergency Engine
(`backend/src/services/emergency.service.ts:48`) and a single client Emergency Engine
(`mobile/src/emergency/EmergencyEngine.ts:139`) so the side-effects (notify, track,
record, persist) are identical and duplicate-activation is impossible.

**Target users.** Civilians, lone travellers, students, women walking at night —
anyone for whom the phone itself is the only safety device they carry. The product
positioning is a single-user "I am in trouble" device; the recipient of the alert is
the user's trusted contact (who does not need to be a SafeLink account holder).

**Overall architecture.**

```mermaid
flowchart TB
  subgraph Mobile["Mobile (Expo SDK 54 / RN 0.81.5)"]
    Auth[Firebase Auth + AsyncStorage persistence]
    UI[React Native UI]
    Engine[Emergency Engine + SafetyTimerController + AIVoiceController]
    RecSvc[recording.service.ts]
    Loc[expo-location]
    Net[expo-notifications + NetInfo + AsyncStorage]
    Speech[expo-speech-recognition]
    Native[(EmergencyRecordingService.java)]
  end
  subgraph Backend["Backend (Node 20 / Express 4 / Mongoose 8)"]
    AuthMW[verifyFirebaseToken middleware]
    Svc[emergency.service / notification.service / timer.service / firebase.service / oss.service / maps.service]
    Routes[/api/auth,users,contacts,emergencies,journeys,ai,recordings,history,timers/]
    Sweeper[setInterval timer sweeper]
  end
  subgraph Cloud["Cloud services"]
    Firebase[(Firebase Auth + FCM)]
    Mongo[(MongoDB Atlas)]
    OSRM[OSRM demo]
    Nom[Nominatim]
    OSS[(Alibaba OSS - configured but unused in current recorder)]
  end
  Mobile -- HTTPS + Firebase ID token --> Backend
  Backend --> Mongo
  Backend -- Admin SDK --> Firebase
  Backend -- FCM --> Firebase
  Backend --> OSRM
  Backend --> Nom
  Mobile <-- Foreground service intent --> Native
```

**How the major components communicate.**

1. The mobile app speaks to the backend exclusively over HTTPS using a single
   `axios` instance (`mobile/src/services/api.ts:20`) with the Firebase ID token
   attached by a request interceptor (`api.ts:29-41`).
2. The Android native recorder is reached through a small React Native bridge
   module (`EmergencyRecordingModule.java`) that translates JS method calls into
   Android `Intent`s to a `Service` (`EmergencyRecordingService.java`).
3. The backend talks to MongoDB via Mongoose models, to Firebase via the
   `firebase-admin` SDK (`firebase.service.ts`), to FCM via the same SDK
   (`sendMulticastNotification` at `firebase.service.ts:65`), and to OSRM/Nominatim
   via `axios` (`maps.service.ts`).
4. The backend runs a 15-second `setInterval` Safety-Timer sweeper
   (`timer.service.ts:144`) so a timer escalates even when the user's app is
   closed.

---

## 2. Technology stack

This table lists **only** technologies actually imported/used by the code (verified
against `package.json`, `app.json`, `AndroidManifest.xml`, Java imports, and TS
imports), not aspirational README claims.

| Technology | Purpose | Where used | Status |
|---|---|---|---|
| React Native 0.81.5 | Native runtime | `mobile/package.json:24` | ✅ |
| React 19.1.0 | UI library | `mobile/package.json:22-23` | ✅ |
| Expo SDK 54 (`expo@~54.0.0`) | Build/runtime abstraction | `mobile/package.json:9` | ✅ |
| Expo Development Build (`expo-dev-client`) | Dev client (needed for native modules) | `mobile/package.json:13`, `app.json` plugins | ✅ |
| TypeScript 5.9.2 | Static types | `mobile/package.json:31`, `tsconfig.json` | ✅ |
| Zustand 5 | Global state | `mobile/package.json:27`, `mobile/src/store/index.ts:159` | ✅ |
| Axios 1.20 | HTTP client | `mobile/package.json:8`, `mobile/src/services/api.ts:1` | ✅ |
| Firebase JS SDK 12 (Auth) | Client-side auth | `mobile/package.json:21`, `mobile/src/config/firebase.ts:1-9` | ✅ |
| `firebase-admin` 12 | Server-side auth + FCM | `backend/package.json:19`, `backend/src/services/firebase.service.ts:1` | ✅ |
| `expo-location` 19 | GPS | `mobile/package.json:16`, `mobile/src/services/location.service.ts:1` | ✅ |
| `expo-notifications` 0.32 | Local notifications + lock-screen SOS | `mobile/package.json:18`, `mobile/src/services/notifications.service.ts:1` | ✅ |
| `expo-audio` 1.0 | iOS fallback recorder + History playback | `mobile/package.json:11`, `recording.service.ts:1,106`, `HistoryScreen.tsx:3` | 🟡 (iOS path only) |
| `expo-file-system` 19 (legacy) | Local recording metadata + path | `mobile/package.json:14`, `recording.service.ts:4` | ✅ |
| `expo-speech-recognition` (jamsch) 3.1.3 | On-device STT + RMS volume | `mobile/package.json:19`, `mobile/src/aiVoiceDetection/detection/speechAdapter.ts:38` | ✅ (requires dev build) |
| `expo-asset`, `expo-font`, `expo-status-bar` | Asset/typography/status | `mobile/package.json:10,15,20` | ✅ |
| `expo-constants` | App constants | `mobile/package.json:12` | ✅ |
| `react-native-web` 0.21 | Web target | `mobile/package.json:25` | 🟡 (parity not all features) |
| `react-native-webview` 13.15 | Leaflet map host | `mobile/package.json:26`, `mobile/src/components/OsmMapView.tsx:3` | ✅ |
| `@react-native-async-storage/async-storage` 2.2 | Persistent key-value (auth, profile, recordings metadata, active emergency/timer ids) | `mobile/package.json:6`, `firebase.ts:11`, `storage.ts`, `recording.service.ts:5` | ✅ |
| `@react-native-community/netinfo` 11.4 | Connectivity | `mobile/package.json:7`, `mobile/src/services/network.service.ts:1` | ✅ |
| Node.js (express 4.18) | HTTP server | `backend/package.json:17` | ✅ |
| TypeScript 5.3 | Server types | `backend/package.json:43` | ✅ |
| Mongoose 8 | MongoDB ODM | `backend/package.json:23` | ✅ |
| MongoDB driver 7.5 (raw, used for `mongodb-memory-server` tests) | Tests | `backend/package.json:22` | 🟡 (tests only) |
| Joi 17 | Request validation | `backend/package.json:21` | ✅ |
| `helmet` 7 | HTTP hardening | `backend/package.json:20`, `server.ts:31` | ✅ |
| `cors` 2.8 | CORS allow-list | `backend/package.json:15`, `server.ts:32-39` | ✅ |
| `express-rate-limit` 7.1 | Rate limit (auth & global) | `backend/package.json:18`, `server.ts:42-54` | ✅ |
| `morgan` 1.10 + `winston` 3.11 | Logging | `backend/package.json:24,27` | ✅ |
| `dotenv` 16 | Env loading | `backend/package.json:16` | ✅ |
| `multer` 1.4 | Multipart upload (recording fallback path) | `backend/package.json:25`, `recording.routes.ts:13-28` | 🟡 (used in legacy OSS upload path) |
| `axios` 1.6 | Outbound HTTP (OSRM, Nominatim) | `backend/package.json:14`, `maps.service.ts:1` | ✅ |
| `uuid` 9 | ID generation | `backend/package.json:26` | 🚫 (imported but no callsite in current routes) |
| `ali-oss` 6.20 | Alibaba Cloud OSS SDK | `backend/package.json:13`, `oss.service.ts:1` | 🚫 (configured; not on current recording path) |
| `jest` 29 + `supertest` 6 + `ts-jest` + `mongodb-memory-server` 9 | Test framework | `backend/package.json:31-41` | 🟡 (no committed tests reference them) |
| Android Java (Java 17 source level) | Native recorder service + bridge | `mobile/android/app/src/main/java/com/anonymous/mobile/*` | ✅ |
| `AudioRecord` (Android Media) | PCM capture | `EmergencyRecordingService.java:104` | ✅ |
| Android `Service` + `startForeground` | Guaranteed background mic | `EmergencyRecordingService.java:60-93, 221-233` | ✅ |
| Android `NotificationCompat` | Foreground notification | `EmergencyRecordingService.java:222-228` | ✅ |
| OpenStreetMap raster tiles | Map | `mobile/src/components/OsmMapView.tsx:57` | ✅ |
| Leaflet 1.9.4 (via CDN) | Map renderer inside WebView | `OsmMapView.tsx:35,44,53` | ✅ |
| OSRM public demo | Routing | `backend/src/services/maps.service.ts:15` | ✅ |
| Nominatim | Reverse geocoding | `backend/src/services/maps.service.ts:16` | ✅ |
| Gradle 8.14 + AGP via Expo | Android build | `./gradlew assembleDebug` | ✅ (BUILD SUCCESSFUL on JDK 17) |

### What is **not** used despite being installed

- `ali-oss` is a hard dependency and `oss.service.ts` is real code, but the
  currently shipping native recorder writes WAV files to the device's app-private
  storage (`getFilesDir()/SafeLink/recordings/<id>/segment_NNNNNNNN.wav` —
  `EmergencyRecordingService.java:80`) and does **not** upload to OSS. The OSS
  upload path (`recording.routes.ts:49-104`, `:107-153`) is only exercised by the
  older multipart fallback in `recordingAPI.uploadMultipart` (`api.ts:231-240`),
  which is **not** called by the current `recording.service.ts`. ✅ / 🚫 (config
  present, not on hot path).
- `uuid` is imported by no source file in `backend/src`; it is in `package.json`
  only. 🚫
- `multer` is wired up but the only consumer is the unused OSS multipart route. 🚫
- `google-cloud/speech` is mentioned in `backend/.env.example` only
  (`GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`); no code references
  it. The AI pipeline is on-device via `expo-speech-recognition`. 🚫

---

## 3. Complete feature inventory

Each row is verified against the file/line shown under Evidence.

| Feature | Description | Mobile | Backend | DB | External | Status | Evidence / file |
|---|---|---|---|---|---|---|---|
| User registration | Email/password Firebase + backend profile | ✅ | ✅ | ✅ | Firebase Auth | ✅ | `auth.service.ts:64-76`, `auth.routes.ts:18-47`, `User.model.ts:35-69` |
| User login | Email/password | ✅ | ✅ | ✅ | Firebase Auth | ✅ | `auth.service.ts:78-87`, `auth.routes.ts:50-72` |
| Logout | Clears FCM token + AsyncStorage | ✅ | ✅ | ✅ | — | ✅ | `auth.routes.ts:75-78`, `App.tsx:115`, `auth.service.ts:90-93` |
| Forgot password | Firebase reset email | ✅ | ✅ (logs only) | — | Firebase Auth | ✅ | `AuthScreen.tsx:56-67`, `auth.routes.ts:81-86` |
| User profile (`GET /users/me`, `PUT /users/me`) | Update name/phone/preferences/AI settings | ✅ | ✅ | ✅ | — | ✅ | `user.routes.ts:12-25, 54-77` |
| Trusted contacts list | Read sorted by priority | ✅ | ✅ | ✅ | — | ✅ | `contact.routes.ts:21-27`, `ContactsScreen.tsx` |
| Add contact | Joi-validated, 10-color avatar pool | ✅ | ✅ | ✅ | — | ✅ | `contact.routes.ts:30-48`, `ContactsScreen.tsx:40-64` |
| Edit contact | Joi-validated update | 🚫 UI | ✅ | ✅ | — | 🟡 | `contact.routes.ts:51-63` exists; no edit screen |
| Delete contact | Confirm dialog + cascade | ✅ | ✅ | ✅ | — | ✅ | `contact.routes.ts:66-74`, `ContactsScreen.tsx:66-81` |
| Manual SOS | Hold-3-seconds button → activate | ✅ | ✅ | ✅ | — | ✅ | `HomeScreen.tsx:59-81`, `EmergencyEngine.ts:139-174` |
| Emergency activation (idempotent) | `createEmergency` reuses open one | — | ✅ | ✅ | — | ✅ | `emergency.service.ts:48-90` |
| Live location tracking | `watchPositionAsync` 5 m / 5 s | ✅ | ✅ | ✅ | — | ✅ | `location.service.ts:68-87`, `emergency.routes.ts:106-122` |
| Live location freshness | LIVE/STALE/OFFLINE | ✅ | — | — | — | ✅ | `EmergencyEngine.ts:276-284` |
| Reverse geocoding | First fix of an emergency | — | ✅ | — | Nominatim | ✅ | `emergency.service.ts:79-83`, `maps.service.ts:82-106` |
| Emergency resolve | `I'm safe` + notify "resolved" | ✅ | ✅ | ✅ | FCM | ✅ | `EmergencyEngine.ts:195-219`, `emergency.routes.ts:82-91` |
| Emergency cancel | False alarm | ✅ | ✅ | ✅ | — | ✅ | `EmergencyEngine.ts:222-240`, `emergency.routes.ts:94-103` |
| Emergency history | Paginated list | ✅ | ✅ | ✅ | — | ✅ | `HistoryScreen.tsx`, `history.routes.ts:12-41` |
| Emergency detail | With recording + AI event | ✅ | ✅ | ✅ | — | ✅ | `history.routes.ts:44-92` |
| Risk level | LOW/MEDIUM/HIGH/CRITICAL | ✅ | ✅ | — | — | ✅ | `Emergency.model.ts:5`, `riskFromConfidence` |
| Trusted-contact notification | FCM multicast to linked SafeLink users + persisted alert record per contact | ✅ | ✅ | ✅ | FCM | 🟡 | `notification.service.ts:55-124` (push only fires if contact email matches a SafeLink user with `fcmToken`) |
| Safety Timer start | Presets + custom minutes | ✅ | ✅ | ✅ | — | ✅ | `SafetyTimerScreen.tsx:85-99`, `timer.routes.ts:52-98` |
| Safety Timer check-in | "I'm safe" | ✅ | ✅ | ✅ | — | ✅ | `SafetyTimerController.ts:182-198`, `timer.routes.ts:132-142` |
| Safety Timer cancel | User cancels | ✅ | ✅ | ✅ | — | ✅ | `SafetyTimerController.ts:203-215`, `timer.routes.ts:184-194` |
| Safety Timer extend | Add time | ✅ | ✅ | ✅ | — | ✅ | `SafetyTimerController.ts`, `timer.routes.ts:107-128` |
| Safety Timer auto-escalation (client) | `phaseFor` derived from server timestamps | ✅ | — | — | — | ✅ | `SafetyTimerController.ts:51-58` |
| Safety Timer auto-escalation (server) | 15 s sweeper | — | ✅ | ✅ | — | ✅ | `timer.service.ts:144-153` |
| "I need help" button | Manual timer → emergency | ✅ | ✅ | ✅ | FCM | ✅ | `SafetyTimerController.ts:221-226`, `timer.routes.ts:146-181` |
| AI voice detection (keyword) | Levenshtein-tolerant matcher | ✅ | — | — | `expo-speech-recognition` | ✅ | `keywordMatcher.ts:103-133` |
| AI voice detection (acoustic) | Heuristic loudness envelope (default classifier; pluggable) | ✅ | — | — | Same STT `volumechange` | ✅ | `acousticAnalyzer.ts:59-108` |
| AI voice detection (fusion) | Combined confidence + risk + caps acoustic-only at 74 | ✅ | — | — | — | ✅ | `fusion.ts:38-70` |
| AI log to backend | `POST /ai/detection` | ✅ | ✅ | ✅ | — | ✅ | `ai.routes.ts:12-48` |
| AI user response | `PUT /ai/detection/:id/respond` | ✅ | ✅ | ✅ | — | ✅ | `ai.routes.ts:51-65` |
| AI settings read/write | `GET/PUT /ai/settings` | ✅ | ✅ | ✅ | — | ✅ | `ai.routes.ts:68-92` |
| AI auto-escalate HIGH | Countdown + SOS | ✅ | ✅ | ✅ | FCM | ✅ | `AiVoiceDetectionController.ts:251-298` |
| AI cooldown / debounce | 20 s suppression | ✅ | — | — | — | ✅ | `config.ts:56` |
| Native Android recorder (PCM 44.1 kHz mono) | `AudioRecord` foreground service | ✅ (native) | — | — | Android | ✅ | `EmergencyRecordingService.java:96-120` |
| 30-second WAV segmentation | Per-segment WAV finalization | ✅ (native) | — | — | Android | ✅ | `EmergencyRecordingService.java:123-146` |
| Local recording metadata | AsyncStorage index of segments | ✅ | — | — | — | ✅ | `recording.service.ts:52-76` |
| Recording playback | `expo-audio` `createAudioPlayer` | ✅ | — | — | — | ✅ | `HistoryScreen.tsx:42-67` |
| Recording delete | Removes from AsyncStorage | ✅ | — | — | — | ✅ | `recording.service.ts:201-208` |
| Persist recordings across app restart | Files in `getFilesDir()`; AsyncStorage index | ✅ | — | — | — | ✅ | `EmergencyRecordingService.java:80`, `recording.service.ts:39` |
| Sign-out cleanup | `emergencyEngine.reset()` + `storage.clearSession()` + Firebase sign-out | ✅ | — | — | — | ✅ | `SettingsScreen.tsx:64-78`, `EmergencyEngine.ts:261-273` |
| Microphone permission (Android) | `RECORD_AUDIO`, `FOREGROUND_SERVICE_MICROPHONE` | ✅ (manifest) | — | — | — | ✅ | `AndroidManifest.xml:8-10`, `app.json:27-32` |
| Location permission | `ACCESS_FINE/COARSE_LOCATION` | ✅ | — | — | — | ✅ | `AndroidManifest.xml:2-3` |
| Notification permission | `POST_NOTIFICATIONS` | ✅ | — | — | — | ✅ | `AndroidManifest.xml:6` |
| Lock-screen SOS action | Persistent notification + category | ✅ | — | — | — | ✅ | `notifications.service.ts:48-90` |
| Cold-start restore | `hydrateSession` + `emergencyEngine.restore` + `safetyTimerController.sync` | ✅ | ✅ | — | — | ✅ | `App.tsx:84-101`, `EmergencyEngine.ts:246-258` |
| Map (live location) | Leaflet/OSM in WebView | ✅ | — | — | OSM CDN | ✅ | `OsmMapView.tsx` |
| Map fallback | Coordinates card on web / offline | ✅ | — | — | — | ✅ | `LiveLocationScreen.tsx:84-99`, `OsmMapView.tsx:185-194` |
| Route planning (Journey) | Origin/dest, OSRM ETA, polyline | ✅ | ✅ | ✅ | OSRM | 🟡 | `journey.routes.ts:12-69`, no active screen consuming it |
| Route deviation report | Marks journey `deviated` | 🚫 UI | ✅ | ✅ | — | 🟡 | `journey.routes.ts:111-123`, no UI |
| Rate limiting | Global + 10/15 min on `/api/auth` | — | ✅ | — | — | ✅ | `server.ts:42-54` |
| CORS allow-list | Expo dev, deep links, frontend | — | ✅ | — | — | ✅ | `server.ts:32-39` |
| Health check | `GET /health` | — | ✅ | — | — | ✅ | `server.ts:68-75` |
| Multi-language UI | English only | — | — | — | — | ⚪ | All copy in English |
| Cloud recording backup | Alibaba OSS upload | — | ✅ | — | Alibaba OSS | 🚫 | `recording.routes.ts` legacy multipart path not called by current recorder |
| Firebase Storage upload | — | — | — | — | — | ⚪ | No Firebase Storage client code anywhere |
| IOT band / wearable trigger | Placeholder for future `activate({ source })` | — | — | — | — | ⚪ | Type union doesn't include it yet |

---

## 4. SafeLink SOS flow

This is the **actual** end-to-end path on Android, verified by the source files
called out inline.

```mermaid
sequenceDiagram
  participant U as User
  participant H as HomeScreen.tsx
  participant EE as EmergencyEngine.ts (client)
  participant API as api.ts (axios + Firebase ID)
  participant BE as emergency.service.ts (server)
  participant T as trusted contacts
  participant FCM as Firebase Admin / FCM
  participant N as EmergencyRecordingService.java
  participant DB as MongoDB
  U->>H: Hold SOS 3 s
  H->>EE: emergencyEngine.activate({ source: 'MANUAL_SOS' })
  EE->>API: GET /emergencies/active  (no, only on restore)
  EE->>API: getCurrentPosition (expo-location)
  EE->>API: POST /emergencies { type, lat, lng, riskLevel }
  API->>BE: verifyFirebaseToken (middleware)
  BE->>DB: Emergency.create (status: 'active')
  BE->>BE: notifyContacts(user, emergency, 'SOS_ACTIVATED')
  BE->>DB: Notification.create per contact
  BE->>FCM: sendMulticastNotification to linked SafeLink users
  FCM-->>T: Push "🚨 SafeLink Emergency Alert"
  BE-->>EE: 201 { emergency, notification }
  EE->>EE: setActiveEmergency, phase=ACTIVE
  EE->>EE: recordingService.start(emergencyId)
  EE->>N: ACTION_START intent via EmergencyRecordingModule.start
  N->>N: captureActive=true (synchronous)
  N->>N: AudioRecord init → startRecording() in SafeLinkRecorder thread
  N-->>JS: captureActive stays true
  EE->>EE: startTracking → watchPositionAsync(5s)
  loop every 5 s while active
    EE->>API: POST /emergencies/:id/location
    API->>DB: $push locationHistory, $set currentLatLng
  end
  loop every 30 s while active
    N->>N: write WAV segment + finalize
  end
  loop every 3 s (recording watchdog)
    EE->>API: GET status
    API->>N: getStatus
  end
  U->>H: tap "I'm Safe"
  H->>EE: emergencyEngine.resolve()
  EE->>API: PUT /emergencies/:id/resolve
  API->>BE: resolveEmergency
  BE->>DB: status=resolved, durationSeconds, endedAt
  BE->>FCM: sendMulticastNotification 'EMERGENCY_RESOLVED'
  BE-->>EE: 200
  EE->>N: ACTION_STOP
  N->>N: release AudioRecord
  EE->>EE: clearActiveEmergency, phase=IDLE
```

**Auth requirement.** Every protected route goes through
`verifyFirebaseToken` (`auth.middleware.ts:11-48`), which decodes the Firebase ID
token, then loads the corresponding `User` document and rejects the request if no
`active` user matches. Mobile attaches the token via
`api.interceptors.request.use` (`api.ts:29-41`).

**Duplicate-SOS guard.** The same `Emergency` is returned if one is already
`activating`/`active` for this user (`emergency.service.ts:48-59`).
`EmergencyEngine.activate` mirrors that on the client side
(`EmergencyEngine.ts:141-143`).

**Error handling.** All routes use the `asyncHandler` wrapper
(`errorHandler.ts:39-41`) so thrown errors go to `errorHandler`
(`errorHandler.ts:9-30`) and produce `{ error, stack? }` JSON with the right status
code.

**Notifications.** A trusted contact who is **not** a SafeLink account holder only
gets a `Notification` document persisted; the FCM push is only delivered when the
contact's email matches a SafeLink user with `fcmToken` (`notification.service.ts:85-99`).
The `"N notified"` count in the UI reflects the total active contacts, not the
delivered push count.

---

## 5. Recording system — very detailed

This is the system the team just stabilized. The following is the full and current
state.

### Files and roles

| Layer | File | Role |
|---|---|---|
| JS service | `mobile/src/services/recording.service.ts` | Public API: `start(emergencyId)`, `stop(handle)`, `listLocalRecordings`, `deleteLocalRecording`. Owns the 30 s segment metadata loop, AsyncStorage index, and the Android bridge calls. |
| Client engine | `mobile/src/emergency/EmergencyEngine.ts` | Calls `recordingService.start(emergencyId)` inside `enterActive()` (`EmergencyEngine.ts:115`) and `recordingService.stop(recordingHandle)` inside `resolve`, `cancel`, `reset` (`EmergencyEngine.ts:203,231,262`). |
| React UI | `mobile/src/screens/EmergencyActiveScreen.tsx` | Renders the live recording badge and segment count; **does not** start/stop the recorder itself. |
| React UI | `mobile/src/screens/HistoryScreen.tsx` | Lists `localRecordings` from `recordingService.listLocalRecordings()` and exposes play / delete (`HistoryScreen.tsx:42-67, 93, 179`). |
| React Native bridge | `mobile/android/app/src/main/java/com/anonymous/mobile/EmergencyRecordingModule.java` | JS-callable methods `start(recordingId, segmentSeconds)`, `stop()`, `getStatus()`, `getCompletedSegments(recordingId)`, `deleteSegment(uri)`. Builds Android `Intent`s. |
| React Native package | `mobile/android/app/src/main/java/com/anonymous/mobile/EmergencyRecordingPackage.java` | Registers the module with the React bridge. |
| Native service | `mobile/android/app/src/main/java/com/anonymous/mobile/EmergencyRecordingService.java` | Owns the `AudioRecord`, the segment timer, the WAV writer, foreground service. |
| Manifest | `mobile/android/app/src/main/AndroidManifest.xml` | Declares the service with `android:foregroundServiceType="microphone"` and `android:exported="false"`. |
| App config | `mobile/app.json` (line 27-32) | Adds `RECORD_AUDIO`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS`. |
| Expo plugin | `mobile/app.json` (plugins) | `expo-audio` plugin included. |

### Audio configuration (from `EmergencyRecordingService.java`)

| Parameter | Value | Source |
|---|---|---|
| Sample rate | 44 100 Hz | `SAMPLE_RATE = 44100` (line 31) |
| Channels | MONO | `CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO` (line 32) |
| Encoding | PCM 16-bit | `AUDIO_ENCODING = AudioFormat.ENCODING_PCM_16BIT` (line 33) |
| Microphone source | `MediaRecorder.AudioSource.MIC` | line 104 |
| Buffer size | `max(minBuffer * 2, 4096)` | line 103 |
| Segment duration | 30 s (configurable per intent, clamped to ≥ 10 s) | `SEGMENT_SECONDS = 30` in JS; `intent.getIntExtra(EXTRA_SEGMENT_SECONDS, 30)` (line 75) |
| File format | WAV (RIFF/WAVE PCM, 44-byte header) | `writeWavHeader` (line 148-155), `updateWavHeader` (line 157-161) |
| Storage | `getFilesDir()/SafeLink/recordings/<recordingId>/segment_NNNNNNNN.wav` | line 80, 125-126 |
| Notifications | Foreground notification, channel `safelink-emergency-recording`, `FOREGROUND_SERVICE_TYPE_MICROPHONE` (Q+) | `startForegroundCompat` (line 221-233) |

### Permissions

From `AndroidManifest.xml:1-13` and `app.json:27-32`:
`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`, `INTERNET`,
`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `VIBRATE`.

### The complete current lifecycle

1. **`emergencyEngine.activate(...)` is called** (e.g. `HomeScreen.tsx:65`).
2. **`enterActive(emergency)`** sets `activeEmergency`, then calls
   `recordingService.start(emergency.id)` (`EmergencyEngine.ts:115`).
3. **`recordingService.start`** requests `RECORD_AUDIO` permission via
   `expo-audio`, sets `active = handle`, then issues
   `nativeRecorder.start(handle.recordingId, SEGMENT_SECONDS)`
   (`recording.service.ts:150-165`).
4. **`EmergencyRecordingModule.start`** posts the `ACTION_START` intent via
   `startForegroundService` (line 41-49) and resolves the JS Promise
   **immediately**. JS does **not** wait for AudioRecord init; captureActive is
   flipped synchronously inside `onStartCommand` so a follow-up `getStatus` from
   JS would see `recording: true` without polling.
5. **`EmergencyRecordingService.onStartCommand`** validates the recording id,
   refuses duplicate START for a different recordingId, creates the per-emergency
   directory, sets `captureActive = true` **synchronously** before spawning the
   recorder thread, and starts the foreground service
   (`EmergencyRecordingService.java:68-94`).
6. **`startRecordingThread`** calls `AudioRecord.getMinBufferSize`,
   constructs `AudioRecord(MIC, 44 100, MONO, PCM_16BIT, bufferSize)`, asserts
   `STATE_INITIALIZED`, calls `startRecording()`, and asserts
   `RECORDSTATE_RECORDING` (`EmergencyRecordingService.java:96-120`).
7. **The segment loop** logs `segment timer started`, then runs
   `writeSegment(bufferSize)` which writes a `.part` WAV file with a placeholder
   header, reads PCM in a loop until the segment deadline, closes, then renames
   `.part` to `.wav` after patching the RIFF header with the real byte count
   (`EmergencyRecordingService.java:123-146`).
8. **`recordingService.recordLoop`** runs a 3 s poll calling
   `nativeRecorder.getStatus()` and `collectNativeSegments()`. The poll also
   surfaces UI state (`recordingStatus`, `recordingDurationSeconds`,
   `recordingUploadedChunks`) (`recording.service.ts:84-101`).
9. **`emergencyEngine.resolve/cancel/reset`** invokes
   `recordingService.stop(handle)`, which calls `nativeRecorder.stop()`, waits
   300 ms, then drains `getCompletedSegments(...)` into AsyncStorage
   (`recording.service.ts:176-188`).
10. **`EmergencyRecordingService.stopCaptureAndSelf`** is idempotent
    (`stopCaptureAndSelf()` returns early if `shuttingDown` is true), then
    `releaseRecorderLocked` stops the AudioRecord if still recording, releases
    it, sets `captureActive = false`, and logs `recorder released`
    (`EmergencyRecordingService.java:182-192, 168-180`).
11. **After app restart**, files persist under `getFilesDir()`. The AsyncStorage
    `safelink.localRecordings` key holds the metadata index; the
    `HistoryScreen` lists them via `recordingService.listLocalRecordings()`.

### Local metadata, playback, delete

- `recordingService.saveSegment` (`recording.service.ts:59-76`) inserts into the
  AsyncStorage index with `recordingId = <activeId>-<index>`, `fileName =
  segment-NNN.wav`, `contentType = audio/wav`.
- `HistoryScreen.LocalRecordingRow` (`HistoryScreen.tsx:42-67`) instantiates
  `createAudioPlayer(item.localUri)` and toggles `player.play()` /
  `player.pause()`.
- `recordingService.deleteLocalRecording` (`recording.service.ts:201-208`) calls
  `FileSystem.deleteAsync` and prunes the AsyncStorage index.

### The previously discovered START/STOP race

**Root cause.** Before the fix, `recordingService.start`
(`recording.service.ts` historic content, pre-fix) called
`nativeRecorder.getStatus()` immediately after `nativeRecorder.start()`. The
service's `captureActive` was set to `true` **only inside the recording thread**
— after `recorder.startRecording()` had succeeded. The JS `getStatus()` call
returned `{ recording: false }`, JS threw `Native recorder did not start`, and the
JS catch handler immediately issued `nativeRecorder.stop()`. The STOP intent
landed on the same service before the recording thread reached
`recorder.startRecording()`. With `shuttingDown = true`, the thread's `while
(!shuttingDown)` body never executed, and the `finally` block released the
recorder. The net effect was: `service created → permission=0 → minBufferSize →
STOP → state=1 → startRecording() → recorder released` with `bytesWritten=0`.

**Fix (currently shipping).**

1. The JS layer no longer polls `getStatus()` after `start()`. The bridge
   promise resolving is treated as success (`recording.service.ts:158-160`).
2. The Android service sets `captureActive = true` **synchronously** in
   `onStartCommand(ACTION_START)` before the recording thread is spawned
   (`EmergencyRecordingService.java:88-92`). A `getStatus()` from JS in the same
   tick will now see `recording: true` if it ever does run.
3. Duplicate START for a different `recordingId` is ignored with `start
   ignored: already recording recordingId=...` instead of tearing down the live
   recorder (`EmergencyRecordingService.java:78-79`).
4. STOP is idempotent: a second STOP logs `stop ignored: already shuttingDown`
   and returns (`EmergencyRecordingService.java:182-186`).
5. Lifecycle markers log in the order requested:
   `COMMAND START`, `COMMAND STOP`, `onStartCommand action=...`,
   `startRecording source=MIC`, `service onDestroy`, `segment timer started`,
   `segment timer cancelled`. The JS layer logs `startRecording() called` and
   `stopRecording() called`.

### Storage summary (what to say to judges)

| Question | Answer (verified in code) |
|---|---|
| Where are recordings stored? | App-private storage on the device (`Context.getFilesDir()`), under `SafeLink/recordings/<recordingId>/`. Not accessible to other apps. |
| What format? | WAV (RIFF/WAVE), PCM 16-bit mono, 44.1 kHz, 30 s segments. |
| Any cloud backup? | **No.** No code in the current native recorder uploads to OSS, Firebase Storage, or any backend endpoint. |
| Is Firebase Storage used? | **No.** No Firebase Storage code anywhere. |
| Is Alibaba OSS used? | **No** on the current recording path. The OSS service code (`oss.service.ts`) and multipart route (`recording.routes.ts:49-104`) exist as a legacy path that the current `recordingService` does not call. |
| Is there a mock recorder? | **No.** The native Java code is the real recorder (`AudioRecord` + `FileOutputStream`). |
| Is there playback? | Yes, via `expo-audio`'s `createAudioPlayer` in `HistoryScreen.LocalRecordingRow`. |
| Are recordings persisted across app restart? | Yes — files are in `getFilesDir()`, and the AsyncStorage index is the only thing that has to be rebuilt. |
| Are recordings deleted on sign-out? | **No.** `EmergencyEngine.reset()` only calls `recordingService.stop(null)` (no-op if `handle === null`) and clears `activeEmergencyId` / `userProfile` from AsyncStorage. The actual WAV files and the local recordings index stay on disk. This is a known limitation. |

---

## 6. Database architecture

All models live in `backend/src/models/`. Mongoose timestamps are enabled on every
schema. Indexes are listed where they exist.

### `User` (`User.model.ts:35-69`)

- Collection: `users`
- Required: `firebaseUid` (unique, indexed), `name`, `email` (unique, lowercased),
  `phone`
- Optional: `profileImage`, `fcmToken`, `accountStatus` (`active|suspended|deleted`,
  default `active`)
- Subdocuments:
  - `emergencyPreferences`: `autoEscalate` (default false), `escalationDelaySeconds`
    (30), `aiAutoActivate` (false), `aiConfidenceThreshold` (85),
    `locationUpdateIntervalNormal` (30), `locationUpdateIntervalEmergency` (5)
  - `aiSettings`: `enabled` (true), `keywords` (default en/ur list incl. `help`,
    `bachao`, `bachaoo`, `save me`, `madad karo`, `stop`, …), `keywordLanguages`
    (`['en','ur']`), `acousticDetection` (true), `confidenceThreshold` (75)
  - `privacySettings`: `shareLocation` (true), `shareRecordings` (true),
    `dataRetentionDays` (90)
- Indexes: `firebaseUid` unique
- Used by: every authenticated route (authorization owner), `contact.routes`,
  `notification.service` (resolve contact → SafeLink user for FCM),
  `emergency.service` (notifyContacts), `ai.routes` (`/ai/settings`).

### `TrustedContact` (`TrustedContact.model.ts:16-28`)

- Collection: `trustedcontacts`
- Required: `userId` (ref `User`, indexed), `name`, `phone`, `relationship`
- Optional: `email` (lowercased), `priority` (1–10, default 1), `status`
  (`active|inactive`, default `active`), `avatarColor` (default `#7C3AED`)
- Indexes: `(userId, priority)`
- Used by: `contact.routes.ts`, `notification.service.ts`.

### `Emergency` (`Emergency.model.ts:51-89`)

- Collection: `emergencies`
- Required: `userId` (ref `User`, indexed), `type`
  (`MANUAL_SOS|AI_DETECTION|SAFETY_TIMER|ROUTE_DEVIATION|OTHER`), `status`
  (`activating|active|resolved|cancelled|escalated`, default `activating`, indexed),
  `riskLevel` (`LOW|MEDIUM|HIGH|CRITICAL`, default `HIGH`),
  `activationSource` (same enum)
- Optional: `currentLatitude`, `currentLongitude`, `currentAddress`,
  `locationHistory: [LocationPoint]`, `startedAt` (default now), `endedAt`,
  `durationSeconds`, `notifiedContacts` (default 0), `recordingId` (ref
  `Recording`), `aiEventId` (ref `AiDetectionEvent`), `journeyId` (ref
  `Journey`), `safetyTimerId` (ref `SafetyTimer`), `notes`
- Indexes: `(userId, createdAt: -1)`, `(status, userId)`, and the `status` index
  from the field
- Used by: `emergency.routes.ts`, `emergency.service.ts`, `history.routes.ts`,
  `timer.service.ts`, `recording.routes.ts`.

### `LocationPoint` (sub-schema, `Emergency.model.ts:39-49`)

- Required: `latitude`, `longitude`
- Optional: `accuracy`, `speed`, `direction`, `timestamp` (default now)
- No `_id` (`{ _id: false }`)

### `Recording` (`Recording.model.ts:32-60`)

- Collection: `recordings`
- Required: `emergencyId` (ref `Emergency`, indexed), `userId` (ref `User`,
  indexed)
- Optional: `ossKey`, `ossUrl`, `storageProvider` (`alibaba-oss|oss`), `fileType`
  (default `audio/m4a`), `durationSeconds`, `sizeBytes`, `uploadStatus`
  (`recording|uploading|uploaded|failed|retrying|completed`, default `recording`),
  `uploadAttempts` (default 0), `chunks: [IRecordingChunk]`, `lastUploadedAt`,
  `startedAt` (default now), `endedAt`
- Subdocument `IRecordingChunk`: `index`, `ossKey`, `sizeBytes`,
  `durationSeconds`, `uploadedAt`
- Indexes: `emergencyId`, `userId`
- Used by: `recording.routes.ts`, `emergency.routes.ts` (links on session
  creation), `history.routes.ts`. **Not** written by the current native recorder.

### `AiDetectionEvent` (`AiDetectionEvent.model.ts:22-50`)

- Collection: `aidetectionevents`
- Required: `userId` (ref `User`, indexed), `detectionType`
  (`KEYWORD|SCREAM|DISTRESS_AUDIO|COMBINED`), `confidence` (0–100), `riskLevel`
  (same enum as Emergency)
- Optional: `emergencyId` (ref `Emergency`), `detectedPhrase`,
  `actionTaken` (`ALERT_SHOWN|SOS_ACTIVATED|CANCELLED|IGNORED`, default
  `ALERT_SHOWN`), `keywordConfidence`, `acousticConfidence`, `rawTranscript`,
  `detectedAt` (default now), `respondedAt`
- Indexes: `(userId, detectedAt: -1)`
- Used by: `ai.routes.ts`, `history.routes.ts`.

### `SafetyTimer` (`SafetyTimer.model.ts:40-62`)

- Collection: `safetytimers`
- Required: `userId` (ref `User`, indexed), `durationSeconds`, `expiryTime`,
  `status` (`active|expired|cancelled|extended|resolved|escalated`, default
  `active`, indexed)
- Optional: `journeyId` (ref `Journey`), `note`, `destination`,
  `responseGracePeriodSeconds` (default 30), `extensions` (default 0),
  `lastLatitude`/`lastLongitude`/`lastLocationAt` (for sweeper fallback),
  `emergencyId` (ref `Emergency`)
- Indexes: `(userId, status)`, `(expiryTime, status)`, plus the field indexes
- Used by: `timer.routes.ts`, `timer.service.ts`.

### `Notification` (`Notification.model.ts:29-57`)

- Collection: `notifications`
- Required: `recipientUserId` (ref `User`, indexed), `type` (9-value enum),
  `title`, `message`
- Optional: `emergencyId` (ref `Emergency`), `data` (Map<String,String>),
  `deliveryStatus` (`pending|sent|delivered|failed`, default `pending`),
  `fcmMessageId`, `deliveredAt`
- Indexes: `(recipientUserId, createdAt: -1)`
- Used by: `notification.service.ts`. **Note:** the `recipientUserId` is the
  *user who activated* the emergency, not the trusted contact. The record is
  an audit trail of "contact N was alerted"; a future feature for a contact's own
  SafeLink inbox would need to either change the model or add a
  `recipientContactId`.

### `Journey` (`Journey.model.ts:44-80`)

- Collection: `journeys`
- Required: `userId`, `origin` (`address`, `latitude`, `longitude`),
  `destination` (same), `travelMode` (`driving|walking|bicycling|transit`,
  default `driving`), `distanceMeters`, `expectedDurationSeconds`,
  `expectedEta`, `status` (`planned|active|completed|cancelled|deviated`, default
  `planned`, indexed)
- Optional: `actualArrival`, `routePolyline`, `deviationThresholdMeters`
  (default 200), `deviationDetectedAt`, `startedAt`, `completedAt`,
  `emergencyId`
- Indexes: `(userId, createdAt: -1)`, `status`
- Used by: `journey.routes.ts`. **No mobile screen currently creates or reads
  journeys** — this is a stub API awaiting the journey screen.

### Relationships

```mermaid
erDiagram
  USER ||--o{ TRUSTED_CONTACT : owns
  USER ||--o{ EMERGENCY : owns
  USER ||--o{ SAFETY_TIMER : owns
  USER ||--o{ AI_DETECTION_EVENT : owns
  USER ||--o{ JOURNEY : owns
  USER ||--o{ NOTIFICATION : "audit recipient"
  EMERGENCY ||--o{ LOCATION_POINT : "embedded"
  EMERGENCY ||--o| RECORDING : links
  EMERGENCY ||--o| AI_DETECTION_EVENT : "may link"
  EMERGENCY ||--o| JOURNEY : "may link"
  EMERGENCY ||--o| SAFETY_TIMER : "may link"
  SAFETY_TIMER }o--|| EMERGENCY : escalates_to
```

---



## 7. Backend API documentation

Base URL (current dev config, mobile/src/services/api.ts:18):
http://192.168.0.100:5000/api (LAN IP; emulator uses 10.0.2.2).

| Method | Endpoint | Auth | Purpose | Request body | Response | Status codes |
|---|---|---|---|---|---|---|
| GET  | /health | none | Health probe | -- | { status, service, version, timestamp } | 200 |
| POST | /api/auth/register | none (Firebase ID token in body) | Create backend profile for a Firebase user | { name, email, phone, firebaseIdToken } | { message, user } | 201, 400, 409 |
| POST | /api/auth/login | none (token in body) | Upsert FCM token, return profile | { firebaseIdToken, fcmToken? } | { user } | 200, 400, 404 |
| POST | /api/auth/logout | Bearer | Clear FCM token | -- | { message } | 200, 401 |
| POST | /api/auth/forgot-password | none | Stub (Firebase client handles email) | { email } | { message } | 200, 400 |
| GET  | /api/users/me | Bearer | Current profile (incl. prefs) | -- | { id, name, email, phone, profileImage, emergencyPreferences, aiSettings, privacySettings, createdAt } | 200, 401, 404 |
| PUT  | /api/users/me | Bearer | Update profile / prefs / AI / privacy | partial of the above | { message, user } | 200, 400, 401 |
| PUT  | /api/users/me/password | Bearer | Stub (handled client-side) | -- | { message } | 200 |
| GET  | /api/contacts | Bearer | List trusted contacts | -- | { contacts: [TrustedContact] } | 200 |
| POST | /api/contacts | Bearer | Add contact (auto avatar color) | { name, phone, email?, relationship, priority?, status?, avatarColor? } | { message, contact } | 201, 400, 401 |
| PUT  | /api/contacts/:id | Bearer | Update contact | same as create | { message, contact } | 200, 400, 404 |
| DELETE | /api/contacts/:id | Bearer | Delete contact | -- | { message } | 200, 404 |
| POST | /api/emergencies | Bearer | Activate (idempotent) | { type, latitude?, longitude?, riskLevel?, aiEventId?, journeyId? } | { message, reused, emergency, notification } | 201 / 200 (reused), 400, 401 |
| GET  | /api/emergencies/active | Bearer | Current open emergency (for restore) | -- | { emergency } or { emergency: null } | 200, 401 |
| GET  | /api/emergencies/:id | Bearer | Single emergency + linked recording | -- | { emergency: { ...serialized, recording? } } | 200, 404 |
| PUT  | /api/emergencies/:id/resolve | Bearer | Resolve + notify "safe" | -- | { message, durationSeconds, notification } | 200, 404 |
| POST | /api/emergencies/:id/cancel | Bearer | Mark cancelled (no "safe" push) | -- | { message } | 200, 404 |
| POST | /api/emergencies/:id/location | Bearer | Append live point | { latitude, longitude, accuracy?, speed?, direction? } | { message } | 200, 400, 404 |
| GET  | /api/emergencies/:id/location | Bearer | Last location + last 10 history points | -- | { latitude, longitude, address, lastUpdated, locationHistory } | 200, 404 |
| GET  | /api/journeys | Bearer | List journeys | -- | { journeys } | 200 |
| GET  | /api/journeys/:id | Bearer | Single journey | -- | { journey } | 200, 404 |
| POST | /api/journeys | Bearer | Plan a journey (OSRM route) | { originAddress, originLatitude, originLongitude, destinationAddress, destinationLatitude, destinationLongitude, travelMode?, deviationThresholdMeters? } | { journey: { id, origin, destination, travelMode, distanceMeters, expectedDurationSeconds, expectedEta, routePolyline, status } } | 201, 400, 401 |
| POST | /api/journeys/:id/start | Bearer | Mark ctive | -- | { message, journey } | 200, 404 |
| POST | /api/journeys/:id/end | Bearer | Mark completed | -- | { message, journey } | 200, 404 |
| POST | /api/journeys/:id/deviation | Bearer | Mark deviated + reverse geocode | { latitude, longitude } | { message, address } | 200, 404 |
| POST | /api/ai/detection | Bearer | Log a detection event | { detectedPhrase?, detectionType, confidence, keywordConfidence?, acousticConfidence?, rawTranscript?, actionTaken?, emergencyId? } | { event: { id, riskLevel, confidence } } | 201, 400 |
| PUT  | /api/ai/detection/:id/respond | Bearer | Record user response | { actionTaken: 'SOS_ACTIVATED' or 'CANCELLED' } | { message, event } | 200, 400, 404 |
| GET  | /api/ai/settings | Bearer | Get iSettings | -- | { settings } | 200, 401 |
| PUT  | /api/ai/settings | Bearer | Patch iSettings | { enabled?, keywords?, acousticDetection?, confidenceThreshold? } | { settings } | 200, 400 |
| POST | /api/emergencies/:emergencyId/recordings/session | Bearer | Create an OSS-backed recording session | -- | { recording: { id, emergencyId, uploadStatus } } | 201, 404 |
| POST | /api/emergencies/:emergencyId/recordings | Bearer + multipart | Legacy OSS upload; not called by current native recorder | multipart udio + { recordingId?, chunkIndex?, durationSeconds } | { recording } | 201, 400, 404, 413 |
| POST | /api/recordings/:id/chunks | Bearer | Presigned PUT URL for one chunk | { index, contentType? } | { uploadUrl, ossKey, expiresInSeconds } | 200, 400, 404 |
| POST | /api/recordings/:id/chunks/:index/confirm | Bearer | Mark chunk uploaded | { sizeBytes, durationSeconds } | { recording: { id, uploadStatus, uploadedChunks } } | 200, 400, 404 |
| POST | /api/recordings/:id/finalize | Bearer | Mark complete | -- | { recording: { id, uploadStatus, uploadedChunks } } | 200, 404 |
| POST | /api/recordings/:id/retry-upload | Bearer | Fresh presigned URL | -- | { uploadUrl, ossKey } | 200, 400, 404 |
| PUT  | /api/recordings/:id | Bearer | Patch upload status / size / duration | { uploadStatus?, durationSeconds?, sizeBytes? } | { recording: { id, uploadStatus } } | 200, 400, 404 |
| GET  | /api/emergencies/:emergencyId/recordings | Bearer | List recordings (with download URLs) | -- | { recordings: [ ... ] } | 200, 404 |
| GET  | /api/history | Bearer | Paginated emergency list | ?page=&limit= | { history, pagination } | 200, 401 |
| GET  | /api/history/:id | Bearer | Detailed emergency | -- | { emergency: { ...serialized, recording?, aiDetection? } } | 200, 404 |
| POST | /api/timers | Bearer | Create Safety Timer | { durationSeconds, note?, destination?, journeyId?, responseGracePeriodSeconds?, latitude?, longitude? } | { reused, timer } | 201, 200 (reused), 400 |
| GET  | /api/timers/active | Bearer | The user's current open timer | -- | { timer } or { timer: null } | 200 |
| PUT  | /api/timers/:id/extend | Bearer | Extend expiry | { additionalSeconds } | { timer } | 200, 400, 404 |
| PUT  | /api/timers/:id/resolve | Bearer | "I'm safe" | -- | { message, timer } | 200, 409 |
| POST | /api/timers/:id/escalate | Bearer | App-driven escalation | { latitude?, longitude? } | { message, reused, emergency, notification } | 201, 200 (reused), 400, 404, 409 |
| DELETE | /api/timers/:id | Bearer | Cancel timer | -- | { message } | 200, 409 |

### Middleware and error handling

- helmet() (server.ts:31).
- cors({ origin: [FRONTEND_URL, exp://localhost:8081, /safelink:\/\/.*/], credentials: true }) (server.ts:32-39).
- Global limiter (default 100 / 15 min) and uthLimiter (10 / 15 min) for /api/auth (server.ts:42-56).
- express.json({ limit: '10mb' }) and express.urlencoded (server.ts:59-60).
- erifyFirebaseToken on every protected route, except the legacy OSS recording upload which is also bearer-protected but uses multer first (ecording.routes.ts:11-28).
- Joi validation on every body (Joi 17) for emergency, contact, AI, timer, user.
- errorHandler (errorHandler.ts:9-30) returns { error, stack? } with the status code on the error, hiding the stack in production.
- syncHandler (errorHandler.ts:39-41) wraps every route so thrown errors flow to errorHandler.

### Authorization

All routes that touch a specific user (contacts, emergencies, recordings, timers, journeys, history) scope by eq.user!._id resolved from the Firebase UID lookup in erifyFirebaseToken. There is no admin role; every authenticated user can only act on their own data.

---

## 8. Mobile application architecture

### Stack

- React Native 0.81.5 + React 19.1.0 (mobile/package.json:22-25).
- Expo SDK 54 (managed modules, dev client) (pp.json).
- TypeScript strict (	sconfig.json).
- Zustand for global state (mobile/src/store/index.ts:159).
- No navigation library -- the app uses a single tab bar implemented in App.tsx:181-194 with conditional full-screen render for the active emergency (App.tsx:142-144), the Safety Timer screen (App.tsx:146-155), the auth flow (App.tsx:140), and the splash (App.tsx:128-137).

### High-level state ownership

`mermaid
flowchart LR
  UI[Screens] -- reads/writes --> Store[Zustand store]
  Engine[EmergencyEngine + SafetyTimerController + AIVoiceController]
  Engine -- reads/writes --> Store
  Engine -- axios --> Backend
  Engine -- NativeModules --> Recorder
  Auth[AuthScreen / auth.service] -- onAuthStateChanged --> App
  App -- restore --> Engine
`

### Services

| Service | File | Purpose |
|---|---|---|
| uth.service.ts | Firebase primitives: register, sign in, sign out, password reset, ID token, auth state | mobile/src/services/auth.service.ts |
| pi.ts | Single axios instance + grouped APIs (auth/user/contacts/emergency/journey/ai/recording/history/timer) | mobile/src/services/api.ts |
| session.service.ts | Bridges Firebase identity to backend profile; hydrateSession, egisterBackendUser | mobile/src/services/session.service.ts |
| contacts.service.ts | Trusted-contact CRUD (calls contactsAPI and updates the store) | mobile/src/services/contacts.service.ts |
| location.service.ts | expo-location wrapper: permission, getCurrentPosition, watchPosition | mobile/src/services/location.service.ts |
| 
etwork.service.ts | NetInfo wrapper for online/offline | mobile/src/services/network.service.ts |
| 
otifications.service.ts | Local notifications + lock-screen SOS action | mobile/src/services/notifications.service.ts |
| ecording.service.ts | Native bridge, segment loop, AsyncStorage metadata, history playback list | mobile/src/services/recording.service.ts |
| storage.ts | Typed AsyncStorage keys: ctiveEmergencyId, ctiveTimerId, userProfile | mobile/src/services/storage.ts |
| EmergencyEngine | Client-side lifecycle (activate/adopt/restore/resolve/cancel/reset) | mobile/src/emergency/EmergencyEngine.ts |
| SafetyTimerController | Client-side countdown tick + escalate path | mobile/src/emergency/SafetyTimerController.ts |
| AiVoiceDetectionController | STT + acoustic + fusion + state machine | mobile/src/aiVoiceDetection/AiVoiceDetectionController.ts |

### Store shape (mobile/src/store/index.ts)

- Auth: user, isAuthenticated, setUser
- Contacts: contacts[], setContacts, ddContact, emoveContact
- Emergency: ctiveEmergency, setActiveEmergency, updateEmergency, recording: ecordingStatus, ecordingDurationSeconds, ecordingUploadedChunks, ecordingError
- Engine runtime: emergencyPhase, emergencyError, lastLocationUpdateAt, locationAvailable
- Journey: ctiveJourney, setActiveJourney
- Timer: ctiveTimer, 	imerPhase, 	imerError
- AI: iEnabled, currentAiEvent
- App: isOnline

### Permissions

| Permission | Where requested | Notes |
|---|---|---|
| Microphone (expo-audio) | ecording.service.ts:151 | Required for native recorder |
| Speech recognition (expo-speech-recognition) | AiVoiceDetectionController.ts:71 | Required for AI detection |
| Location foreground (expo-location) | location.service.ts:21-28 | equestForegroundPermissionsAsync |
| Notifications (expo-notifications) | 
otifications.service.ts:30-41 | Local + lock-screen SOS |

### Screen inventory

| Screen | Purpose | Main features | APIs / services used |
|---|---|---|---|
| App.tsx | Root: auth gate, tab bar, splash, active emergency takeover, Safety Timer overlay | onAuthChange to hydrateSession/eset; notification response to emergencyEngine.activate; network reconnect to estore + safetyTimerController.sync | All |
| AuthScreen | Login, register, forgot password | Calls egisterWithEmail / signInWithEmail, then egisterBackendUser / hydrateSession + emergencyEngine.restore | uth.service, session.service, irebase.ts |
| HomeScreen | Dashboard; SOS hold-3s; quick actions; trusted-contacts preview; safety timer status | startSOSHold (3s) to emergencyEngine.activate({ source: 'MANUAL_SOS' }) | emergencyEngine |
| ContactsScreen | List, add (modal), delete trusted contacts | loadContacts, createContact, deleteContact | contacts.service |
| HistoryScreen | Emergency list + local recordings; play/pause/delete; filter by status; stats | historyAPI.getAll, ecordingService.listLocalRecordings, createAudioPlayer | pi.ts, ecording.service.ts |
| SettingsScreen | Profile, prefs toggles (autoEscalate/shareLocation/shareRecordings), logout | userAPI.updateMe, signOutUser, emergencyEngine.reset, storage.clearSession | userAPI, uth.service |
| SafetyTimerScreen | Presets + custom; ACTIVE/CHECK_IN/ESCALATING/ERROR phases | safetyTimerController.start/checkIn/cancel/needHelp | SafetyTimerController |
| EmergencyActiveScreen | Full-screen takeover while ctiveEmergency is set; resolve / cancel | Reads ctiveEmergency from store; calls emergencyEngine.resolve/cancel | emergencyEngine |
| LiveLocationScreen | Modal over the active emergency; shows OSM map + LIVE/STALE/OFFLINE pill | watchPosition for the device dot; reads ctiveEmergency for the shared pin | location.service, OsmMapView |
| AiVoiceDetectionScreen | AI control: master switch, live loudness bars, keywords editor, threshold, log | iVoiceController.enable/disable/refreshConfig, iAPI.updateSettings/getSettings | AiVoiceDetectionController, iAPI |
| OsmMapView | Reusable Leaflet-in-WebView map | Pin + device dot + Recenter | WebView |
| DistressAlertOverlay (mounted in App.tsx:179) | Modal alert when iVoiceStore.activeAlert is set | Renders countdown for HIGH; "I'm safe" / "I need help" | useAiVoiceDetection |

### Notification handling

- expo-notifications setNotificationHandler is configured to show banners in foreground (
otifications.service.ts:20-27).
- showLockScreenSosAction creates a persistent notification in the safelink-sos-access channel with category SAFELINK_SOS_ACCESS and the ACTIVATE_SOS action button; App.tsx:51-62 listens for response and routes to emergencyEngine.activate({ source: 'MANUAL_SOS' }).

### Location handling

- getCurrentPosition is one-shot for activation; permission requested if missing.
- watchPosition({ accuracy: High, timeInterval: 5s, distanceInterval: 5m }) is used both by EmergencyEngine.startTracking (sends to backend every fix) and by LiveLocationScreen (renders the device dot).

### Recording handling

- ecording.service.ts:142-188 (start, stop) is the single owner; the screen and engine never call the native bridge directly.

---

## 9. Native Android architecture

### File-level matrix

| File | Purpose | RN bridge | Lifecycle | Permissions | Native deps |
|---|---|---|---|---|---|
| EmergencyRecordingService.java | Owns mic + WAV writer + foreground service | Indirect (receives Intent from module) | onCreate to onStartCommand to onDestroy | RECORD_AUDIO, FOREGROUND_SERVICE, FOREGROUND_SERVICE_MICROPHONE | ndroid.media.AudioRecord, ndroid.media.MediaRecorder.AudioSource.MIC, java.io.FileOutputStream, java.io.RandomAccessFile |
| EmergencyRecordingModule.java | JS-callable module | @ReactMethod start / stop / getStatus / getCompletedSegments / deleteSegment (line 35, 57, 69, 78, 100) | Singleton, lives for the app process | -- | React Native bridge |
| EmergencyRecordingPackage.java | Registers the module | createNativeModules (line 17) | App process | -- | React Native ReactPackage |
| MainActivity.kt | RN activity (portrait) | -- | singleTask | -- | Expo |
| MainApplication.kt | RN application | -- | -- | -- | Expo + EmergencyRecordingPackage |
| AndroidManifest.xml | Declares permissions + service | -- | -- | All the dangerous + mic perms | -- |

### START/STOP commands (native)

- **START** path:
  EmergencyRecordingModule.start(recordingId, segmentSeconds)
  to Intent(ACTION_START, EXTRA_RECORDING_ID, EXTRA_SEGMENT_SECONDS) to
  startForegroundService (Android O+) or startService to
  EmergencyRecordingService.onStartCommand to
  - log onStartCommand action=... (line 75-78)
  - log COMMAND START (line 79)
  - validate id and directory; if duplicate ecordingId, return without re-initializing (line 84-87)
  - set captureActive = true synchronously (line 92)
  - startForegroundCompat() (line 93)
  - startRecordingThread() (line 94)

- **STOP** path:
  EmergencyRecordingModule.stop() to Intent(ACTION_STOP) to startService to
  EmergencyRecordingService.onStartCommand to
  - log COMMAND STOP (line 70)
  - stopCaptureAndSelf():
    - log stop requested bytesWritten=... (line 192)
    - eleaseRecorderLocked(): if recording, ecorder.stop(); then ecorder.release(); ecorder = null; captureActive = false; log ecorder released (line 175-186)
    - interrupt the recording thread
    - stopForeground(STOP_FOREGROUND_REMOVE) and stopSelf()

- **Error propagation** is via lastError (static volatile) and initFailed (static volatile). getStatus returns { recording, initFailed, error, bytesWritten }. The client ecordLoop only checks ecording: false; the initFailed flag is currently informational and is not yet consumed by JS.

### Background execution

- ndroid:foregroundServiceType="microphone" (manifest line 40) and startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) on Android Q+ (EmergencyRecordingService.java:230) ensure capture keeps running while the app is in the background.
- eleaseRecorderLocked is null-safe; a STOP that arrives before the recorder is constructed is a no-op (EmergencyRecordingService.java:169).

### Java-only relevant imports (for completeness)

- ndroid.media.AudioFormat, ndroid.media.AudioRecord, ndroid.media.MediaRecorder
- ndroidx.core.app.NotificationCompat
- com.facebook.react.bridge.{Arguments, Promise, ReactApplicationContext, ReactContextBaseJavaModule, ReactMethod, ReadableMap, WritableArray, WritableMap}

---

## 10. Firebase integration

### Firebase Authentication

- **Client:** irebase/auth (mobile/src/config/firebase.ts:3-9) initialized with EXPO_PUBLIC_FIREBASE_* env vars; initializeAuth(..., { persistence: getReactNativePersistence(AsyncStorage) }) keeps the user signed in across app restarts. Token retrieved via uth.service.ts:57-61 and attached to every axios request.
- **Server:** irebase-admin (ackend/src/services/firebase.service.ts:1-23) with a service account loaded from FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY env vars. erifyIdToken is used by uth.middleware.ts:11-48.
- **Status:** Verified working end-to-end. Registration, login, restore all go through this.

### Firebase Admin

- Single initialization on server boot (server.ts:104-108) with explicit warning if env vars are missing (so /health still works).
- Used only for ID-token verification and FCM. Nothing else.

### Firebase Cloud Messaging (FCM)

- **Token storage:** User.fcmToken (User.model.ts:42). Mobile calls uthAPI.login({ ..., fcmToken }) after Firebase grants a token (session.service.ts:34), which performs a indOneAndUpdate on the user.
- **Sending:** sendPushNotification and sendMulticastNotification (irebase.service.ts:31-92). Android uses priority: 'high', sound: 'emergency_alert', channelId: 'safelink_emergency'.
- **Trigger conditions:** 
otification.service.ts:55-124 is called by createEmergency (for SOS_ACTIVATED) and esolveEmergency (for EMERGENCY_RESOLVED).
- **Limitation:** push only fires when a contact's email matches an existing SafeLink user with cmToken (line 86). Otherwise, only a Notification audit record is persisted. This is not the same as a real public push to a non-SafeLink phone.
- **Foreground/background behavior:** Android shows the OS notification; the SafeLink app itself shows a local presentLocalNotification confirmation (EmergencyEngine.ts:122-128).

### Firebase Storage

- **Not used.** No irebase/storage import, no getStorage call, no storageBucket consumption beyond the config value. The README does not claim it either; this report confirms it.

### Firebase Realtime Database / Firestore

- **Not used.** The only persistence layer is MongoDB + AsyncStorage.

### Required env vars for production

| Variable | Purpose | Used in |
|---|---|---|
| EXPO_PUBLIC_FIREBASE_API_KEY | Firebase web config | irebase.ts:21 |
| EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN | Firebase web config | irebase.ts:22 |
| EXPO_PUBLIC_FIREBASE_PROJECT_ID | Firebase web config | irebase.ts:23 |
| EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET | Firebase web config | irebase.ts:24 (only the value, not the API) |
| EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID | Firebase web config | irebase.ts:25 |
| EXPO_PUBLIC_FIREBASE_APP_ID | Firebase web config | irebase.ts:26 |
| FIREBASE_PROJECT_ID (backend) | Service-account project | irebase.service.ts:12 |
| FIREBASE_CLIENT_EMAIL (backend) | Service-account email | irebase.service.ts:13 |
| FIREBASE_PRIVATE_KEY (backend) | Service-account private key (PEM with escaped \n) | irebase.service.ts:14 |

### Production-readiness

- Auth + FCM work without an external API key beyond the Firebase project configuration.
- Notifications are restricted to contacts who are also SafeLink users; an end-to-end "my mom got the alert on her iPhone without installing the app" story requires either the legacy m4a OSS upload + a non-SafeLink recipient via SMS, or a separate "companion" app.

---

## 11. Location & map system

### How GPS is obtained

- Library: expo-location (mobile/src/services/location.service.ts:1).
- equestLocationPermission calls Location.requestForegroundPermissionsAsync
  and returns 	rue only if granted.
- getCurrentPosition requests permission if missing, then
  Location.getCurrentPositionAsync({ accuracy: High }).
- watchPosition returns a LocationSubscription whose emove() stops
  tracking; the watcher is created with 	imeInterval: intervalSeconds * 1000
  (default 5 s) and distanceInterval: 5 m.

### Update frequency

- One fix on activation (EmergencyEngine.activate -> getCurrentPosition).
- Continuous watchPosition (default 5 s) while the emergency is active
  (EmergencyEngine.startTracking -> sendLocationUpdate every fix). Only
  successful server writes advance lastLocationUpdateAt; the UI shows
  LIVE/STALE/OFFLINE from that timestamp
  (EmergencyEngine.getLiveStatus).

### Where location is stored

- Mobile side: the latest received fix is in useStore.activeEmergency.currentLatitude / currentLongitude (set via updateEmergency inside sendLocationUpdate).
- Server side: appended to Emergency.locationHistory (embedded subdocument) and copied to Emergency.currentLatitude/Longitude (emergency.service.ts:93-106). Reversed-geocoded to currentAddress by Nominatim (emergency.service.ts:79-83).

### How it reaches the backend

- POST /api/emergencies/:id/location (emergency.routes.ts:106-122) with
  { latitude, longitude, accuracy?, speed?, direction? }. The server rejects
  if the emergency isn't ctivating|active for that user.

### How contacts access it

- Inside the app, LiveLocationScreen reads the store and renders the OSM map
  for the device owner. There is no public "contact dashboard" web app in the
  repository; the recipient of the FCM push would need a separate app/UI to
  actually view the map (current limitation; see Section 20).

### Map library and configuration

- OsmMapView (mobile/src/components/OsmMapView.tsx) is a React Native
  WebView that loads inline HTML using Leaflet 1.9.4 from unpkg.com and
  OpenStreetMap raster tiles from 	ile.openstreetmap.org.
- **No API key**, no Google Maps, no billing.
- The WebView posts eady and userpan messages via
  window.ReactNativeWebView.postMessage; the React side uses
  injectJavaScript to update the shared pin, device dot, and follow state.
- A 10 s READY_TIMEOUT_MS falls back to a coordinates card if Leaflet never
  loads.

### Android/iOS differences

- Permission: ACCESS_FINE_LOCATION + ACCESS_COARSE_LOCATION in
  AndroidManifest.xml. iOS uses pp.json:11-16 NSLocationWhenInUseUsageDescription and
  (implicitly via expo-location) NSLocationAlwaysAndWhenInUseUsageDescription are
  **not** declared; foreground-only is the current behavior.
- Background location: not requested. The recording can run in the background
  via the foreground service, but GPS would stop when the JS thread is suspended.
  The current design expects the user to keep the app in the foreground during
  an active emergency (the EmergencyActiveScreen is the full-screen takeover).

### Failure handling

- getCurrentPosition returns 
ull on any error and the Emergency Engine still
  proceeds with the activation; SOS is never blocked on location.
- watchPosition returns 
ull if it can't start, and the engine treats
  locationAvailable = false honestly.
- lastLocationUpdateAt is only set on a confirmed server write, so the
  "LIVE" pill cannot lie about connectivity.

---

## 12. Notification system

### Pipeline

`mermaid
flowchart LR
  Trigger[createEmergency / resolveEmergency] --> NS[notification.service.ts:55-124]
  NS -->|per contact| Audit[(Notification collection)]
  NS -->|multicast| FCM[firebase-admin sendEachForMulticast]
  FCM -->|Android high priority, sound=emergency_alert| Phone[Trusted contact's SafeLink app]
  Phone -->|user taps| Companion[Future: companion web/mobile view]
`

### Device-token storage

- The *owner's* FCM token is stored on the User document (User.model.ts:42,
  User.fcmToken). The mobile uthAPI.login upserts it
  (pi.ts:91-94, uth.routes.ts:55-59). The logout route clears it
  (uth.routes.ts:75-78).
- No FCM token is collected for non-user trusted contacts in the current
  schema; the only way they receive a push is if their email matches another
  SafeLink user that has a token.

### Notification payload

sendMulticastNotification (irebase.service.ts:65-92) sends:
- 
otification.title, 
otification.body
- data: { emergencyId, type, userName, latitude, longitude }
- Android: priority: 'high', 
otification.sound: 'emergency_alert',
  
otification.priority: 'max', channelId: 'safelink_emergency'
- iOS: ps.sound: 'emergency_alert.caf', ps.badge: 1,
  ps.contentAvailable: true, pns-priority: '10'

### Trigger conditions

- createEmergency -> 
otifyContacts(user, emergency, 'SOS_ACTIVATED') (emergency.service.ts:85).
- esolveEmergency -> 
otifyContacts(user, emergency, 'EMERGENCY_RESOLVED') (emergency.service.ts:124).
- The body's text differs for SAFETY_TIMER triggers (
otification.service.ts:26-30).

### Foreground/background behavior

- On the SafeLink device, expo-notifications setNotificationHandler shows
  banners in the foreground (
otifications.service.ts:20-27).
- The app also calls presentLocalNotification for "SafeLink SOS active" /
  "Emergency ended" (EmergencyEngine.ts:122-128, 211).
- Lock-screen SOS: showLockScreenSosAction posts a sticky notification with
  the ACTIVATE_SOS action (
otifications.service.ts:48-90); App.tsx:51-62
  listens for the response and activates SOS without unlocking the app.

### Current limitations

- The FCM "contact" path requires the contact to be a SafeLink user (and have a
  device token). A non-user trusted contact only sees a Notification document
  in the DB.
- There is no SMS / WhatsApp / email fallback; the FCM channel is the only
  delivery mechanism.
- The Notification model records the *owner* as ecipientUserId, not the
  contact. There is no inbox for the contact today.

---

## 13. Safety Timer

### Models, screens, controllers

- Mongoose SafetyTimer.model.ts (see Section 6).
- Mobile SafetyTimerController (mobile/src/emergency/SafetyTimerController.ts).
- Mobile SafetyTimerScreen (mobile/src/screens/SafetyTimerScreen.tsx).
- Backend 	imer.routes.ts + 	imer.service.ts.

### Timer creation

- safetyTimerController.start(durationSeconds, options)
  (SafetyTimerController.ts:135-155):
  1. getCurrentPosition() to seed the timer with a last-known fix.
  2. POST /api/timers with the body.
  3. doptTimer(serverTimer) puts it in the store and starts the 1 s tick.
- The server is the authority: expiryTime = now + durationSeconds, persisted
  in SafetyTimer.expiryTime (	imer.routes.ts:80-95).
- The response includes escalateAt = expiryTime + responseGracePeriodSeconds * 1000
  (	imer.routes.ts:26). Default grace is 30 s (	imer.service.ts:26,
  User.emergencyPreferences.escalationDelaySeconds fallback).

### Countdown

- The mobile tick (SafetyTimerController.onTick, line 99) recomputes the
  phase every 1 s from expiryTime and escalateAt, never from a local
  decrementing counter. This keeps the countdown correct across
  background/reopen/restart.
- Phases: ACTIVE (counting), CHECK_IN (past expiry, inside grace), ESCALATING
  (past grace).
- The Home screen and SafetyTimerScreen both render the same ormatCountdown
  against the server timestamp.

### Expiration

- **Client path:** when phase === 'ESCALATING', utoEscalate is called
  (SafetyTimerController.ts:267-280). With a 15 s backoff guard, it calls
  doEscalate(timer, reason), which sends POST /api/timers/:id/escalate and
  hands the device off to emergencyEngine.adopt(emergency, { announce: false })
  (SafetyTimerController.ts:241-265).
- **Server path:** startTimerSweeper runs sweepTimers every 15 s
  (	imer.service.ts:144-153). sweepTimers finds timers whose
  expiryTime + gracePeriodSeconds <= now, then escalateTimer
  (	imer.service.ts:52-78), which atomically claims the timer with
  indOneAndUpdate (so the client and server never both escalate), then
  delegates to createEmergency and 
otifyContacts. It also promotes running
  timers past expiry but still inside grace to status expired so GET /active
  reflects the "check-in required" state.

### Cancellation

- safetyTimerController.cancel -> DELETE /api/timers/:id. No emergency
  triggered.

### Recovery after app restart

- App.tsx:84-101 runs safetyTimerController.sync() after auth; this calls
  GET /api/timers/active and either adopts the timer (continuing the
  countdown from server timestamps) or clears local state.

### APIs

- See /api/timers table in Section 7.

### Database model

- See SafetyTimer in Section 6.

---

## 14. AI / voice distress detection

### Where detection happens

**On-device only.** No audio is ever uploaded to the backend for analysis.

### The pipeline

`mermaid
flowchart LR
  Mic[expo-speech-recognition volumechange] --> Acoustic[acousticAnalyzer.assess]
  Mic --> Speech[expo-speech-recognition result]
  Speech --> KW[keywordMatcher.matchKeywords]
  Acoustic --> Fusion[fuse]
  KW --> Fusion
  Fusion --> Eval[evaluate -> raiseAlert -> countdown]
  Eval -->|HIGH| Engine[emergencyEngine.activate]
  Eval -->|MEDIUM| Overlay[DistressAlertOverlay user tap]
  Engine --> Backend
`

### speechAdapter.ts (mobile/src/aiVoiceDetection/detection/speechAdapter.ts)

- Wraps expo-speech-recognition behind a tolerant optional-require so a
  missing native module is caught (line 36-44) and reported as
  UNAVAILABLE (AiVoiceDetectionController.ts:60-67).
- Starts continuous recognition with interimResults: true, contextualStrings:
  user.keywords, and olumeChangeEventOptions: { enabled: true, intervalMillis: 250 }
  (line 109-118).
- Auto-restarts on end (AiVoiceDetectionController.handleEnd,
  scheduleRestart).

### keywordMatcher.ts

- Normalizes (lowercase, NFKD, strip diacritics, drop non-letters, collapse
  repeated vowels) and runs a Levenshtein-tolerant comparison against each user
  keyword.
- Confidence is min(100, (55 + 40 * recognizerConfidence) * quality * (0.4 + 0.6 * severity))
  (line 124-126). Recognizer confidence and match quality gate the ceiling;
  severity scales it across a band so a generic "stop" stays MEDIUM and
  "save me" reaches HIGH/auto-SOS.

### cousticAnalyzer.ts

- Maintains a 1.5 s rolling window of normalized loudness samples
  (range -2..10 -> 0..1).
- HeuristicClassifier.assess returns 0..100 confidence and kind: 'SCREAM' or 'DISTRESS_AUDIO' or 'NONE'
  by combining peak loudness, sustained duration above 0.72, and a dynamic-range
  filter that down-weights uniformly-loud sources (music at constant volume).
- AcousticClassifier is pluggable: a YAMNet/TFLite or cloud classifier can be
  injected via nalyzer.setClassifier(...) (line 126-129). The default is
  the heuristic.
- The plugin comments explicitly call out that a real scream-vs-music classifier
  requires an audio ML model; today the code is a heuristic proxy.

### usion.ts

- If both channels fire, take max + 0.4 * min and tag COMBINED.
- Keyword only: keep keyword score, tag KEYWORD.
- Acoustic only: cap at 74 (ACOUSTIC_ONLY_CAP), tag SCREAM or DISTRESS_AUDIO.
  This is the rule that prevents "music at high volume" from silently
  triggering SOS.

### State machine (AiVoiceDetectionController)

OFF -> STARTING -> LISTENING -> DETECTING -> EVALUATING -> ALERTING -> ESCALATING with COOLDOWN, UNAVAILABLE, ERROR as supporting states. Implemented at AiVoiceDetectionController.ts:118-298.

### Thresholds (config)

- utoEscalateThreshold: 75 (default; user-configurable via /ai/settings).
- warnThreshold: 50.
- countdownSeconds: 5 (configurable 3-15).
- lertCooldownMs: 20_000.

### What "AI" is and is not

- The classifier is a **heuristic on top of on-device STT** plus a **loudness-envelope
  classifier**. It is not an ML model and is not cloud-backed.
- The README claim of "AI voice distress detection" is accurate in the sense of
  "computer-assisted detection of distress", but it should not be presented as a
  trained neural network. The code path supports dropping one in
  (AcousticClassifier interface), and the README/team can clarify the
  position.

### APIs and persistence

- POST /api/ai/detection logs every event with detectionType, confidence,
  keywordConfidence?, cousticConfidence?, awTranscript?, ctionTaken?,
  emergencyId? (i.routes.ts:12-48). The server assigns the iskLevel from
  the confidence band.
- PUT /api/ai/detection/:id/respond records the user response.
- GET/PUT /api/ai/settings round-trip the user-controlled thresholds and
  keywords (i.routes.ts:68-92).
- The local iVoiceStore (mobile/src/aiVoiceDetection/aiVoiceStore.ts) holds
  an in-memory log for the AI screen.

### Emergency triggering

- HIGH path (confidence >= utoEscalateThreshold): the controller enters
  ESCALATING after a 5 s countdown (AiVoiceDetectionController.ts:251-298).
  emergencyEngine.activate({ source: 'AI_DETECTION', riskLevel, aiEventId })
  is called. If the user taps "I'm safe" during the countdown, the alert is
  dismissed and cooldownUntil is set.
- MEDIUM path (50-74): an alert is shown but no SOS is auto-activated. The
  user must tap to escalate.

### False-positive / false-negative

- False positive mitigations: dynamic-range rejection in the acoustic
  classifier, ACOUSTIC_ONLY_CAP = 74, 20 s cooldown after every alert,
  per-keyword severity table (common words like "stop" are weighted down),
  5 s user-cancellable countdown before SOS.
- False negatives: the recognizer is expo-speech-recognition (jamsch), which
  on Android uses the OS speech recognizer; accuracy depends on the OS, locale,
  and the device's network policy. The default locale is en-US; other
  locales are configurable via EXPO_PUBLIC_AI_VOICE_LANG.

---

## 15. Security

### Authentication and authorization

- **Client auth** is Firebase email/password with getReactNativePersistence(AsyncStorage). The session survives app restarts. Tokens are refreshed automatically by Firebase.
- **Server auth** is irebase-admin's erifyIdToken for every protected route. The User is loaded by irebaseUid; if not found or ccountStatus != 'active', the request is rejected.
- **Authorization** is per-user ownership for every collection. There is no admin role, no cross-user data access.

### Token handling

- The Firebase ID token is attached to every axios request as Authorization: Bearer <token> (pi.ts:29-41). The interceptor swallows errors so a transient token problem doesn't poison unrelated requests.
- Backend uth.middleware.ts:11-48 distinguishes expired from generic invalid token in the response, so the client can re-auth.

### API protection

- helmet() (server.ts:31).
- CORS allow-list: FRONTEND_URL || http://localhost:3000, exp://localhost:8081, regex safelink:\/\/.* (server.ts:32-39).
- Global limiter (100/15 min) and uthLimiter (10/15 min) (server.ts:42-54).
- Joi validation on all bodies (ackend/src/routes/*.ts).
- File size limit 10mb JSON, 20 MB recording multipart (ecording.routes.ts:15).
- morgan request log to winston (server.ts:63-65).

### Environment variables and secrets

- The backend uses dotenv to load ackend/.env (server.ts:25).
- Mobile uses EXPO_PUBLIC_* (Expo convention) for the Firebase web config.
- The repo ships *.env.example files only; no real keys are present.
- FIREBASE_PRIVATE_KEY is treated as a string with escaped \n and re-converted before use (irebase.service.ts:14).

### Firebase security

- The mobile config is the public Firebase web SDK config (apiKey, appId,
  projectId, ...). These are *not* secrets; they identify the Firebase project
  to the SDK. The actual security boundary is Firebase App Check + Firestore/
  Storage rules, neither of which SafeLink uses (no Firestore, no Storage).

### MongoDB security

- Connection string is MONGODB_URI in ackend/.env; the repo's example uses
  MongoDB Atlas (mongodb+srv://...).
- No data encryption at rest beyond what Atlas provides.
- No field-level access control; Mongoose models are flat for the most part.

### Local recording privacy

- Files live in the app's private getFilesDir(). Not world-readable on
  Android.
- No automatic upload happens today. The user must explicitly hand the device
  over to someone with access to the app to recover the recordings.
- EmergencyEngine.reset() (called on sign-out) does **not** delete the WAV
  files or the local recordings index; this is a deliberate choice (an
  emergency should survive a logout) but a privacy knob could be added.

### Trusted contact authorization

- A contact belongs to exactly one user (TrustedContact.userId). There is no
  way for user A to read or write user B's contacts.

### Emergency ownership

- All emergency mutations scope by userId; the :id route params are
  combined with the user match.

### Input validation

- Joi schemas exist for register, login, contact, emergency create, location,
  AI detection, AI respond, AI settings, timer create, recording sessions,
  recording chunks, etc.
- Lat/long are clamped to real ranges; durations and confidence are bounded.

### CORS

- See above. The Expo dev URL and the deep-link URL pattern are allowed.

### Rate limiting

- Global default 100/15 min (RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS env vars
  with sane defaults). Auth endpoints get a stricter 10/15 min.

### Identified risks (not exploitable, but worth flagging)

- **CRITICAL:** Trusted-contact push only reaches SafeLink users. A non-SafeLink
  contact gets nothing. This is a product gap, not a security bug, but it can
  be presented as a security boundary to keep the contact list private.
- **HIGH:** Recordings are only on-device. Loss of the device loses the
  evidence. The legacy OSS multipart path exists but isn't wired.
- **MEDIUM:** No replay protection on POST /api/emergencies/:id/location --
  a leaked token can flood the location history. Rate limit helps.
- **MEDIUM:** FCM tokens are stored unhashed; a MongoDB read leak would
  expose them. Rotate the Firebase project in the worst case.
- **LOW:** morgan 'combined' logs full request lines including URLs and
  tokens (if a client ever put the token in a query string). Current axios
  config puts it in a header, so logs are safe in practice.

---

## 16. Environment variables & configuration

### Mobile (mobile/.env.example)

| Variable | Required for | Example | Secret? |
|---|---|---|---|
| EXPO_PUBLIC_API_URL | Mobile API root | http://192.168.0.100:5000 | No (LAN IP only) |
| EXPO_PUBLIC_FIREBASE_API_KEY | Firebase web SDK | <firebase api key> | No (public) |
| EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN | Firebase web SDK | <project>.firebaseapp.com | No |
| EXPO_PUBLIC_FIREBASE_PROJECT_ID | Firebase web SDK | <project id> | No |
| EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET | Firebase web SDK (value only, not used) | <project>.appspot.com | No |
| EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID | Firebase web SDK | <sender id> | No |
| EXPO_PUBLIC_FIREBASE_APP_ID | Firebase web SDK | <app id> | No |
| EXPO_PUBLIC_AI_VOICE_LANG | Speech recognizer locale | en-US (default), ur-PK, en-IN | No |

> All EXPO_PUBLIC_* vars are inlined into the JS bundle at build time. They
> are *not* secrets. Do not put private keys here.

### Backend (ackend/.env.example)

| Variable | Required for | Example | Secret? |
|---|---|---|---|
| PORT | Express | 5000 | No |
| NODE_ENV | Express / error stack redaction | development | No |
| MONGODB_URI | Mongoose | mongodb+srv://<user>:<pwd>@cluster0.mongodb.net/safelink | YES (contains password) |
| FIREBASE_PROJECT_ID | Firebase Admin | <project id> | No |
| FIREBASE_CLIENT_EMAIL | Firebase Admin service account | <svc>@<project>.iam.gserviceaccount.com | No |
| FIREBASE_PRIVATE_KEY | Firebase Admin service account | -----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n | YES |
| FRONTEND_URL | CORS allow-list | http://localhost:3000 | No |
| MOBILE_SCHEME | Documented for deep links | safelink | No |
| GOOGLE_CLOUD_PROJECT_ID | **Unused** (no GCP code path) | -- | -- |
| GOOGLE_APPLICATION_CREDENTIALS | **Unused** | -- | -- |
| ALI_OSS_ACCESS_KEY_ID | Alibaba OSS (legacy, unused) | <access key> | YES |
| ALI_OSS_ACCESS_KEY_SECRET | Alibaba OSS (legacy, unused) | <secret> | YES |
| ALI_OSS_BUCKET | Alibaba OSS (legacy, unused) | safelink-recordings | No |
| ALI_OSS_REGION | Alibaba OSS (legacy, unused) | oss-ap-southeast-1 | No |
| ALI_OSS_ENDPOINT | Alibaba OSS (legacy, unused) | https://oss-ap-southeast-1.aliyuncs.com | No |
| RATE_LIMIT_WINDOW_MS | express-rate-limit | 900000 (15 min) | No |
| RATE_LIMIT_MAX | express-rate-limit | 100 | No |
| SAFETY_TIMER_SWEEP_INTERVAL_MS | Server-side timer sweeper | 15000 (15 s) | No |

### Android manifest

- pplicationId (build.gradle / pp.json -> ndroid.package): com.anonymous.mobile.
- The debug signing config is the default Expo debug keystore.

### iOS

- Bundle identifier: com.menahil.safelink (pp.json:16).
- ITSAppUsesNonExemptEncryption: false -> no export compliance questions for
  the App Store.
- NSMicrophoneUsageDescription and NSSpeechRecognitionUsageDescription
  populated; no NSLocationWhenInUseUsageDescription currently
  (pp.json:11-16).

### No actual secret values are reproduced in this report.

---

## 17. Running the project

### Prerequisites

| Tool | Version (what we used) |
|---|---|
| Node.js | 20.x (matches ackend/package.json @types/node@^20) |
| npm | 10.x |
| Java JDK | 17 (Temurin 17.0.20.1, used for ./gradlew assembleDebug) |
| Android SDK | API 36 (compileSdkVersion=36 per pp.json and Expo SDK 54) |
| Android Build Tools | matching platform-36 |
| Android device | API 24+ recommended for expo-speech-recognition and the foreground service |
| ADB | latest platform-tools |
| Expo CLI | 54.x |
| MongoDB | Atlas cluster, or local 7.x |
| Firebase project | email/password auth enabled, a web app configured, a service account JSON |

### Backend startup

`ash
cd safelink/backend
cp .env.example .env
# Fill in MONGODB_URI, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
npm install
npm run dev        # ts-node-dev with respawn
# or
npm run build && npm start
# Server listens on PORT (default 5000)
curl http://localhost:5000/health
`

### Mobile startup (Expo dev client)

`ash
cd safelink/mobile
cp .env.example .env
# Fill in EXPO_PUBLIC_API_URL, EXPO_PUBLIC_FIREBASE_*
npm install
npx expo start                # Metro + dev client
# In a second terminal:
npx expo run:android          # builds a debug APK + installs on the connected device
# or, with a device attached over USB:
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
`

### Why the API URL differs per environment

- The current pi.ts:18 hardcodes http://192.168.0.100:5000/api with a
  comment noting it's for the Android Studio emulator.
- **Android emulator:** the host's localhost is reachable as 10.0.2.2. So
  for an emulator, set EXPO_PUBLIC_API_URL=http://10.0.2.2:5000 and
  recompile.
- **Physical Android phone on the same Wi-Fi:** the phone cannot reach
  localhost; it must reach the laptop's LAN IP. Find it with
  ipconfig (Windows) or ifconfig (macOS/Linux). Update
  EXPO_PUBLIC_API_URL=http://192.168.x.y:5000, restart Metro, and rebuild
  the APK (because EXPO_PUBLIC_* is inlined at build time).
- The phone and laptop must be on the same network. Windows Firewall must
  allow port 5000 inbound; on the laptop, 
etsh advfirewall firewall add
  rule name="SafeLink" dir=in action=allow protocol=TCP localport=5000.

### Physical Android phone setup

1. Enable Developer Options + USB debugging.
2. Plug in, accept the RSA prompt.
3. db devices should list the device.
4. 
px expo run:android (or db install -r ...apk).
5. Grant the runtime permissions: mic (when recording starts), location (when
   SOS is pressed), notifications (when lock-screen SOS is configured).

### ADB commands used during this audit

`ash
adb logcat -c
adb logcat SafeLinkRecorder:V ReactNativeJS:V *:S
# Look for the order:
#   service created
#   COMMAND START
#   onStartCommand action=... startId=1
#   permission=0
#   AudioRecord minBufferSize=...
#   AudioRecord state=1 sampleRate=44100 ...
#   AudioRecord started
#   startRecording source=MIC
#   segment timer started seconds=30
# (and never "stop requested bytesWritten=0" before AudioRecord started)
`

---
