# Direct App Recording — iOS Native + Web Hybrid

## Problem

The current recording-to-catalog workflow requires multiple manual steps: record in Voice Memos (or similar), open browser, navigate to upload page, pick file, wait for upload, then refresh to see results. This friction is the biggest barrier to consistent use. Band members forget to record, or record but never upload.

The recording step is the one thing a browser genuinely cannot do well — background audio capture, lock screen controls, and reliable long-duration recording all require native iOS APIs. Everything else (browsing sessions, tagging tracks, managing setlists) works fine in the existing web UI.

## Solution

Build a minimal iOS app with a hybrid architecture:

- **Native SwiftUI** for the recording experience and upload queue
- **WKWebView** for everything else, loading the existing web frontend
- The API stays unchanged — the app uploads via the existing presigned-URL flow

## Design Decisions

- **Recording is the app's identity.** The record button is the first thing you see. No onboarding wizard, no tutorial — open app, tap record.
- **Hybrid over full-native.** The web UI already handles browsing, tagging, setlists, events, and admin. Rebuilding that in SwiftUI would double the maintenance surface for no user benefit. WKWebView shares the auth cookie seamlessly.
- **Background recording via AVAudioSession.** Category `.record` with `.mixWithOthers` option so the phone can still play music if needed. Background mode `audio` keeps recording when the app is backgrounded or the phone is locked.
- **Upload is automatic, not interactive.** Recordings queue for upload over WiFi using `URLSession` background transfers. The user never manually picks a file.
- **The server doesn't change.** The app uses `POST /api/sessions/upload/init` → presigned PUT → `POST /api/sessions/upload/complete`, the same flow the web uses for R2 uploads. No new endpoints needed.
- **M4A output from the recorder.** Use `AVAudioRecorder` with AAC/M4A format to match the existing pipeline expectation. No transcoding step needed.
- **Filename convention preserved.** The app names files using the same `YYYY-MM-DD-HHMMSS.m4a` pattern the pipeline already parses for session dates.

## App Architecture

### Tab Structure

```
┌─────────────────────────────────┐
│  Record (SwiftUI)               │  Tab 1 — the native experience
│  ├─ Big circular record button  │
│  ├─ Live duration + level meter │
│  ├─ Upload queue status         │
│  └─ Recent recordings list      │
├─────────────────────────────────┤
│  Browse (WKWebView)             │  Tab 2 — existing web app
│  └─ Full web UI in a web view   │
├─────────────────────────────────┤
│  Settings (SwiftUI)             │  Tab 3 — connection config
│  ├─ Server URL                  │
│  ├─ Account (login/logout)      │
│  ├─ Storage usage               │
│  └─ Upload preferences          │
└─────────────────────────────────┘
```

### Recording Flow

```
User taps Record
  → AVAudioSession.setCategory(.record)
  → AVAudioRecorder starts (AAC, 48kHz, 192kbps, M4A container)
  → Lock screen shows recording indicator via NowPlayingInfo
  → Live Activity / Dynamic Island shows elapsed time (iOS 16.1+)

User taps Stop (or app detects extended silence)
  → Recording saved to app sandbox
  → Entry added to upload queue (Core Data)
  → If on WiFi: upload starts immediately
  → If not: upload deferred until WiFi available

Upload:
  → POST /api/sessions/upload/init (get presigned URL + job ID)
  → PUT to presigned R2 URL (background URLSession transfer)
  → POST /api/sessions/upload/complete (trigger processing)
  → Upload status visible in Record tab queue
  → User checks processing progress via Browse tab (web UI)
```

### iOS System Integrations

| Feature | API | Purpose |
|---------|-----|---------|
| Background recording | `AVAudioSession` + `audio` background mode | Record while phone is locked/backgrounded |
| Lock screen controls | `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` | Stop button on lock screen |
| Live Activity | `ActivityKit` | Show recording duration on lock screen/Dynamic Island |
| Background upload | `URLSession` background configuration | Upload even after app is killed |
| WiFi detection | `NWPathMonitor` | Defer uploads to WiFi |
| Haptics | `UIImpactFeedbackGenerator` | Confirm record start/stop |

### Auth Integration

The app and WKWebView share authentication:

1. User logs in via the Settings tab (native SwiftUI form)
2. App calls `POST /api/auth/login`, receives JWT in `Set-Cookie`
3. Cookie is stored in a shared `WKHTTPCookieStore`
4. Both native API calls and the web view use the same cookie
5. API key (`X-API-Key`) as fallback for background uploads where cookies may expire

### Data Storage (On-Device)

Minimal Core Data model for the upload queue:

```
Recording
  ├─ id: UUID
  ├─ filePath: String          (sandbox-relative path)
  ├─ fileSize: Int64
  ├─ duration: Double
  ├─ recordedAt: Date
  ├─ uploadStatus: enum        (pending, uploading, processing, completed, failed)
  ├─ jobId: String?            (server job ID after upload/init)
  ├─ sessionId: Int?           (server session ID after completion)
  ├─ errorMessage: String?
  └─ retryCount: Int16
```

### Error Handling

- **Upload fails:** Retry with exponential backoff (30s, 1m, 2m, 5m, max 3 retries). Show badge on Record tab.
- **Recording interrupted** (phone call, etc.): Save what we have, mark as partial, still queue for upload.
- **Disk space low:** Warn before recording. After successful upload + processing confirmation, offer to delete local copy.
- **Server unreachable:** Queue uploads indefinitely. Show "offline" indicator. Recordings are safe on device.

## Scope

### Included (v1)

- iOS app with SwiftUI record tab + WKWebView browse tab + settings tab
- Background audio recording (AAC/M4A)
- Automatic WiFi upload via existing presigned-URL API
- Lock screen recording controls
- Upload queue with retry logic
- Group selection for multi-group users
- Basic settings (server URL, login, storage)

### Excluded (v1)

- Android app (future, if there's demand)
- Apple Watch app/complication
- Live Activity / Dynamic Island (v1.1 — nice-to-have, not blocking)
- Silence detection / auto-stop (v1.1)
- In-app playback of recordings before upload
- Editing/trimming recordings on device
- Offline browsing of previously loaded sessions
- App Store distribution (TestFlight only for v1)

## Server-Side Changes

None required for v1. The existing upload flow (`/init` → presigned PUT → `/complete`) and job polling work as-is. Processing status is monitored through the web UI (Browse tab), not through native notifications.

## Project Structure

```
ios/
├── JamJar.xcodeproj
├── JamJar/
│   ├── App/
│   │   ├── JamJarApp.swift          (app entry, tab view)
│   │   └── AppState.swift           (shared state, auth)
│   ├── Record/
│   │   ├── RecordView.swift         (main recording UI)
│   │   ├── AudioRecorder.swift      (AVAudioRecorder wrapper)
│   │   ├── LevelMeter.swift         (audio level visualization)
│   │   └── UploadQueueView.swift    (pending uploads list)
│   ├── Browse/
│   │   └── BrowseView.swift         (WKWebView wrapper)
│   ├── Settings/
│   │   ├── SettingsView.swift       (server config, account)
│   │   └── LoginView.swift          (auth form)
│   ├── Services/
│   │   ├── APIClient.swift          (HTTP client, auth)
│   │   ├── UploadManager.swift      (background upload queue)
│   │   └── NetworkMonitor.swift     (WiFi detection)
│   ├── Models/
│   │   └── Recording.swift          (Core Data entity)
│   └── Resources/
│       └── Assets.xcassets
├── JamJarTests/
└── JamJar.xcdatamodeld
```

## Open Questions

1. **TestFlight distribution** — do we need an Apple Developer account already, or is the personal team sufficient for testing?
