# SafeLink — AI-Powered Safety Application

SafeLink is a React Native / Expo mobile safety application with real-time AI voice distress detection, manual SOS, safety timers, trusted contacts, and live location sharing.

## Architecture

```
Mobile (Expo SDK 54 / React Native)
  │
  ├── Firebase Authentication (email/password)
  ├── AI Voice Detection (expo-speech-recognition + heuristic acoustic analysis)
  │     └── Keyword matching + scream detection → distress confidence
  │
  ├── Manual SOS
  ├── Safety Timer
  └── Emergency Engine (single source of truth)
        │
        ▼
Backend (Express + MongoDB + Firebase Admin)
  │
  ├── Emergency service (create / resolve / cancel / live location)
  ├── AI detection logging (/api/ai/detection)
  ├── Trusted contact notifications (FCM via Firebase Admin)
  ├── Safety Timer sweeper (server-side escalation)
  └── Maps / reverse geocoding
        │
        ▼
Firebase Cloud Messaging
  │
  └── Trusted contacts' devices
```

## Repository Structure

```
safelink/
  backend/
    src/
      controllers/       (route handlers)
      middleware/        (auth, error handling)
      models/           (Mongoose schemas)
      routes/           (Express routers)
      services/         (emergency, notification, firebase, timer)
      utils/            (database, logger)
      server.ts         (entry point)
    tests/              (Jest tests)
    .env.example
    package.json

  mobile/
    src/
      aiVoiceDetection/  (FR-28 voice safety module)
        components/      (DistressAlertOverlay)
        detection/       (speechAdapter, acousticAnalyzer, keywordMatcher, fusion)
        screens/         (AiVoiceDetectionScreen)
        AiVoiceDetectionController.ts
        aiVoiceStore.ts
        config.ts
        types.ts
        useAiVoiceDetection.ts
      config/           (firebase)
      emergency/        (EmergencyEngine, SafetyTimerController)
      screens/          (Home, Auth, Contacts, History, Settings, etc.)
      services/         (api, auth, location, notifications, recording, session, storage)
      store/            (Zustand global state)
      theme/            (design system)
      types/            (TypeScript declarations)
    app.json            (Expo config with plugins + permissions)
    .env.example
    package.json
    App.tsx             (root component)
```

## Prerequisites

- Node.js >= 18
- MongoDB (local or Atlas)
- Expo CLI (`npm install -g expo-cli`)
- Android Studio / Xcode (for development builds)
- Firebase project with Auth, Firestore (optional), and Cloud Messaging enabled

## Installation

### Backend

```bash
cd safelink/backend
npm install
cp .env.example .env
# Edit .env and fill in:
#   MONGODB_URI
#   FIREBASE_PROJECT_ID
#   FIREBASE_CLIENT_EMAIL
#   FIREBASE_PRIVATE_KEY
#   GOOGLE_MAPS_API_KEY
```

### Mobile

```bash
cd safelink/mobile
npm install
cp .env.example .env
# Edit .env and fill in:
#   EXPO_PUBLIC_API_URL
#   EXPO_PUBLIC_FIREBASE_*
```

## Environment Variables

### Backend (`.env`)

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 5000) |
| `NODE_ENV` | `development` or `production` |
| `MONGODB_URI` | MongoDB connection string |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin client email |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin private key |
| `GOOGLE_MAPS_API_KEY` | Google Maps / Geocoding API key |
| `GOOGLE_CLOUD_PROJECT_ID` | Google Cloud project ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON |
| `ALI_OSS_*` | Alibaba Cloud OSS (recordings) |
| `FRONTEND_URL` | CORS origin |
| `RATE_LIMIT_*` | Rate limiting config |

### Mobile (`.env`)

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend base URL |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps SDK key |
| `EXPO_PUBLIC_FIREBASE_*` | Firebase client config (public web config) |
| `EXPO_PUBLIC_AI_VOICE_LANG` | Speech recognition locale (default `en-US`) |

## Running the Application

### Start Backend

```bash
cd safelink/backend
npm run dev
```

### Start Mobile (Expo Go — limited)

```bash
cd safelink/mobile
npx expo start
```

> **Note**: In Expo Go, the AI Voice Detection screen shows an honest "development build required" state. Manual SOS, contacts, safety timer, and all other features work normally.

### Start Mobile (Development Build — full AI voice detection)

```bash
cd safelink/mobile
npx expo prebuild
npx expo run:android   # or: npx expo run:ios
```

The development build includes the native `expo-speech-recognition` module, microphone permissions, and speech recognition permissions.

## Lock-screen SOS access (Android)

Android does not allow ordinary third-party apps to add a custom shortcut beside the
system Camera/Torch lock-screen shortcuts. SafeLink therefore uses the supported
alternative: after a signed-in user grants notification permission, the app publishes
an ongoing Android notification with an `Activate SOS` action. On supported devices,
the action is available from the lock-screen notification shade without opening the
normal SafeLink UI. The action brings the app forward so Firebase can restore the
existing authenticated session, then calls the existing
`emergencyEngine.activate({ source: 'MANUAL_SOS' })` path. That path obtains the real
GPS fix, calls `POST /api/emergencies`, stores the emergency, and invokes the existing
trusted-contact notification service. No native code bypasses authentication and no
location or private contact data is placed in the lock-screen notification.

This requires an Expo development build; it is not an Expo Go feature. Build it with:

```bash
cd safelink/mobile
npx expo prebuild
eas build --profile development --platform android
```

The app requests `POST_NOTIFICATIONS` on Android 13+ because Android otherwise hides
the action notification. `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` are used
by the existing Expo Location service after the action opens the app. If notification
permission is denied, the lock-screen action is not published. If location permission,
GPS, network access, or Firebase authentication is unavailable, the existing emergency
engine reports failure and does not claim that SOS was sent.

On a physical device, sign in, allow notifications and location, confirm the
`SafeLink emergency access` notification is visible, lock the phone, expand the
notification shade, and press `Activate SOS`. Verify the backend emergency document,
its real coordinates/timestamp, and the trusted-contact notification. Repeat with the
screen off, no network, GPS disabled, and denied permissions. Notification visibility,
action placement, and whether the device requires a lock-screen unlock are controlled
by the Android version, manufacturer, lock-screen settings, and notification-channel
settings; SafeLink cannot force a Camera/Torch-style shortcut or bypass those policies.

## Emergency audio evidence

After an emergency starts, the mobile app requests microphone permission and records real
30-second M4A segments. On Android, a native microphone foreground service owns capture
and continues while the app is backgrounded or the phone is locked. JavaScript polls the
service for completed files, verifies that each file exists and is non-empty, and stores
metadata in AsyncStorage. The files remain in the app-private
`SafeLink/recordings/<emergencyId>/` directory after SOS resolution and app restart.
There is no cloud upload in the current local-storage mode.

The existing AI voice detector and emergency recorder both use the device microphone.
Android can interrupt microphone ownership for phone calls or another recorder; such
interruptions are reported as a recording failure rather than being represented as a
successful capture. Android declares `FOREGROUND_SERVICE` and
`FOREGROUND_SERVICE_MICROPHONE`; the service displays an ongoing notification while
recording. Android still requires `RECORD_AUDIO` and Android 13+ notification permission.
Calls, another active recorder, battery-management policies, or a force-stop can still
interrupt capture. The service performs no network or authentication work; signed
uploads remain in the existing authenticated JavaScript architecture.

The backend OSS integration remains available for a future opt-in cloud mode, but local
recording does not require Alibaba credentials, Firebase Storage, or a storage bucket.

## AI Voice Detection (FR-28)

### How It Works

1. User enables **Continuous listening** from the AI Detection screen.
2. The app requests microphone and speech recognition permissions.
3. The OS speech recognizer runs continuously, producing:
   - **Transcripts** (keyword detection)
   - **Volume samples** (acoustic / scream detection)
4. The keyword matcher fuzzily matches distress phrases (`help`, `bachao`, `save me`, `madad`, etc.) against transcripts.
5. The acoustic analyzer detects sustained loud vocalizations (screams/shouts) using a rolling loudness envelope.
6. A fusion engine combines both channels into a single 0–100 confidence score.
7. If confidence exceeds the **auto-escalation threshold** (default 75%), a HIGH alert appears with a countdown.
8. If the user does not cancel within the countdown, the existing **Emergency Engine** activates a real SOS — same flow as the manual SOS button.
9. Every detection is logged to the backend via `POST /api/ai/detection`.

### Detection Logic

| Input | Confidence Band | Behavior |
|---|---|---|
| Recognized distress keyword | >= 75% | HIGH alert + countdown → auto-SOS |
| Recognized distress keyword | 50–74% | MEDIUM warning, user confirms only |
| Scream / loud vocalization | Any | MEDIUM warning (acoustic-only capped at 74%, never auto-SOS) |
| Combined keyword + scream | >= 75% | HIGH alert + countdown → auto-SOS |
| Normal speech / noise | < 50% | Logged as IGNORED, no interruption |

### False Positive Protection

- **Cooldown**: 20-second suppression after any alert.
- **Duplicate SOS guard**: The Emergency Engine prevents duplicate activations.
- **User verification**: HIGH alerts show a countdown with "I'm Safe / Cancel".
- **Acoustic-only cap**: Screams without keywords never auto-SOS.

### Permissions

| Platform | Permission | Purpose |
|---|---|---|
| iOS | `NSMicrophoneUsageDescription` | Microphone access |
| iOS | `NSSpeechRecognitionUsageDescription` | Speech recognition |
| Android | `RECORD_AUDIO` | Microphone access |
| Android | `MODIFY_AUDIO_SETTINGS` | Audio routing for recognition |

## Testing the Complete Flow

### Test 1 — Normal Speech
1. Start app, log in.
2. Home → AI Detection → toggle **Continuous listening** ON.
3. Grant permissions.
4. Speak normally.
5. **Expected**: No alert. Status stays LISTENING.

### Test 2 — Distress Keyword
1. Voice Safety ON.
2. Say **"help"** or **"bachao"**.
3. **Expected**: HIGH alert + countdown. If no cancel → SOS activates.

### Test 3 — Scream
1. Voice Safety ON.
2. Scream or shout loudly.
3. **Expected**: MEDIUM warning. No auto-SOS.

### Test 4 — False Alarm
1. Wait for HIGH alert.
2. Tap **"I'm Safe / Cancel"**.
3. **Expected**: Alert dismissed. No SOS.

### Test 5 — No Response
1. Wait for HIGH alert.
2. Do nothing until countdown reaches 0.
3. **Expected**: SOS activates. Contacts notified.

### Test 6 — Permission Denied
1. Deny microphone permission.
2. **Expected**: Status shows ERROR with instructions. App does not crash.

### Test 7 — Network Unavailable
1. Turn off Wi-Fi / mobile data.
2. Enable voice detection.
3. **Expected**: Detection works locally. Logging queues for later. App does not crash.

### Test 8 — Manual SOS Still Works
1. With voice detection ON, press and hold the SOS button.
2. **Expected**: Manual SOS activates normally.

## Known Platform Limitations

| Feature | Limitation |
|---|---|
| **AI Voice Detection in Expo Go** | Not available. `expo-speech-recognition` is a native module and requires a custom development build. |
| **Background microphone (app backgrounded / lock screen)** | Not supported on iOS. On Android, continuous recognition works while backgrounded only on Android 13+ with `com.google.android.as` service. Lock-screen detection is not guaranteed. |
| **Terminated app (app killed)** | Detection stops. The backend Safety Timer sweeper is the authoritative escalation clock for closed apps. |
| **Web** | Not supported. The module shows UNAVAILABLE on web. |
| **Expo Go (Android)** | Expo Go SDK 53+ removed remote push support on Android. Trusted contact push notifications require a development build + FCM configuration. |

## Troubleshooting

### "Speech module isn't included in Expo Go"
You need a development build:
```bash
npx expo prebuild
npx expo run:android   # or npx expo run:ios
```

### "Microphone permission denied"
Go to device Settings → SafeLink → Permissions and enable Microphone and Speech Recognition.

### Backend won't start
Ensure `MONGODB_URI` and `FIREBASE_*` variables are set in `backend/.env`.

### Build fails after `npm install`
Delete `node_modules` and reinstall:
```bash
cd mobile && rm -rf node_modules && npm install
```

## Backend API Reference

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | No | Create backend account |
| POST | `/api/auth/login` | No | Sync FCM token, get profile |
| GET | `/api/users/me` | Yes | Get full profile + preferences |
| PUT | `/api/users/me` | Yes | Update profile / preferences |
| POST | `/api/emergencies` | Yes | Activate SOS (idempotent) |
| GET | `/api/emergencies/active` | Yes | Restore open emergency |
| POST | `/api/emergencies/:id/cancel` | Yes | Cancel false alarm |
| PUT | `/api/emergencies/:id/resolve` | Yes | Resolve "I'm safe" |
| POST | `/api/emergencies/:id/location` | Yes | Push live location |
| POST | `/api/ai/detection` | Yes | Log AI detection event |
| PUT | `/api/ai/detection/:id/respond` | Yes | Record user response |
| GET | `/api/ai/settings` | Yes | Get AI settings |
| PUT | `/api/ai/settings` | Yes | Update AI settings |

## License

MIT
