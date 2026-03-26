# iOS App: Native Recording with Web Hybrid Browsing

Minimal iOS app with native SwiftUI recording and WKWebView for everything else. One-tap record, automatic upload over WiFi, existing web UI for browsing/tagging/admin.

## Problem

The current workflow (record in Voice Memos, open browser, navigate, upload, wait) has too much friction. Band members forget to record or record but never upload. There's no way to record directly into the system.

## Solution

A hybrid iOS app with two native responsibilities — recording and uploading — and a web view for everything else. The existing web UI already handles browsing, tagging, setlists, and admin well. Recording is the one thing a browser can't do reliably (background audio, lock screen controls, long-duration capture).

No server changes required for v1. The app uses the existing presigned-URL upload flow (`upload/init` -> PUT to R2 -> `upload/complete`).

## Decisions

1. **Apple Developer account:** Paid individual account ($99/year), TestFlight distribution
2. **Push notifications:** Not in v1. Poll job status on app-foreground + local notifications from background URLSession transfers. Processing takes ~10 seconds so the user is typically still on the upload screen when it completes
3. **Group selection:** Per-recording picker on the record screen. Auto-selected and hidden when user belongs to one group

## App Structure

### Tab bar

| Tab | Implementation | Purpose |
|-----|---------------|---------|
| Record | SwiftUI | Big record button, live duration/levels, upload queue |
| Browse | WKWebView | Existing web app with shared auth |
| Settings | SwiftUI | Server URL, login, storage info |

### Record Tab

The primary screen. Designed for "walk into rehearsal, tap record, forget about it."

**Recording state machine:**

```
Idle → Recording → Stopped → Uploading → Done
                      ↓
                   (save local, queue for upload)
```

**UI elements:**
- Large circular record button (red pulsing when active)
- Live duration timer
- Audio level meter (RMS from AVAudioEngine tap)
- Stop button (replaces record button during recording)
- Upload queue list showing pending/in-progress/completed uploads

**Recording behavior:**
- Audio format: AAC in M4A container (matches server's expected input)
- AVAudioSession category: `.playAndRecord` with `.defaultToSpeaker`
- Background audio entitlement enabled — recording continues when app is backgrounded or device is locked
- Lock screen controls via MPNowPlayingInfoCenter (pause/stop)
- Files saved to app's Documents directory with filename format: `YYYY-MM-DD_HHmmss.m4a`
- Group picker: dropdown at top of screen, populated from `GET /api/auth/me` group list. Hidden if user has one group

**Upload behavior:**
- Automatic when on WiFi (NWPathMonitor)
- Uses existing API flow: `POST /api/sessions/upload/init` -> presigned PUT to R2 -> `POST /api/sessions/upload/complete`
- Background URLSession for transfers — uploads survive app backgrounding and app termination
- On background transfer completion, fire a local notification: "Recording uploaded — processing started"
- Poll `GET /api/jobs/{id}` when app returns to foreground to update status
- Retry with exponential backoff on failure (max 3 attempts)
- Queue is persisted to disk (JSON file) so uploads survive app restarts

### Browse Tab

WKWebView loading the Jam Jar web app. Minimal native code.

**Auth integration:**
- After login in Settings tab, inject the JWT cookie into WKWebView's cookie store
- WKWebView and native code share a WKProcessPool to maintain cookie state
- If the web view receives a 401, surface a "please re-login in Settings" message

**Behavior:**
- Load server URL from Settings on tab activation
- Standard web view navigation (back/forward via swipe gestures)
- Pull-to-refresh
- External links open in Safari

### Settings Tab

Simple SwiftUI form.

**Fields:**
- Server URL (text field, validated on save)
- Login (email + password, calls `POST /api/auth/login`, stores JWT in Keychain)
- Logged-in user display (name, email, role)
- Upload settings: WiFi-only toggle (default: on)
- Storage info: number of local recordings, disk usage, "clear uploaded recordings" button
- App version

**Auth flow:**
1. User enters server URL and credentials
2. App calls `/api/auth/login`, receives JWT cookie
3. Store JWT in Keychain
4. Inject cookie into WKWebView cookie store
5. Populate user info from `/api/auth/me`

## iOS Frameworks

| Framework | Purpose |
|-----------|---------|
| AVFoundation | Audio recording (AVAudioEngine + AVAudioSession) |
| MediaPlayer | Lock screen / Control Center controls |
| Network | NWPathMonitor for WiFi detection |
| WebKit | WKWebView for Browse tab |
| BackgroundTasks | Background URLSession for uploads |
| UserNotifications | Local notifications on upload completion |
| Security | Keychain storage for JWT |

## Data Model (Local)

```swift
struct Recording: Codable, Identifiable {
    let id: UUID
    let filename: String        // YYYY-MM-DD_HHmmss.m4a
    let groupId: Int
    let groupName: String
    let createdAt: Date
    let durationSec: Double
    var uploadState: UploadState
    var jobId: String?          // from upload/init response
    var jobStatus: String?      // pending, processing, completed, failed
}

enum UploadState: String, Codable {
    case pending
    case uploading
    case completed
    case failed
}
```

Recordings list persisted as JSON in the app's Documents directory. Simple and sufficient for the expected volume (a few recordings per week).

## Project Structure

```
JamJar/
  JamJarApp.swift              # App entry, tab view
  Models/
    Recording.swift            # Recording data model
    RecordingStore.swift       # Persistence + upload queue
  Views/
    RecordTab/
      RecordView.swift         # Main record screen
      AudioLevelView.swift     # Level meter component
      UploadQueueView.swift    # Upload status list
      GroupPicker.swift        # Group selector
    BrowseTab/
      BrowseView.swift         # WKWebView wrapper
    SettingsTab/
      SettingsView.swift       # Settings form
      LoginView.swift          # Login sheet
  Services/
    AudioRecorder.swift        # AVAudioEngine wrapper
    UploadManager.swift        # Background URLSession + queue
    APIClient.swift            # Server communication
    KeychainHelper.swift       # JWT storage
  JamJar.entitlements          # Background audio, etc.
```

## Entitlements & Permissions

- `NSMicrophoneUsageDescription` — "Jam Jar records your jam sessions for upload to your band's catalog"
- Background Modes: `audio` (recording), `fetch` (background transfers)
- Keychain access for JWT storage

## Scope

### v1 (this spec)
- Record tab with background recording and lock screen controls
- Automatic WiFi upload via presigned URLs
- Browse tab with shared auth
- Settings with login and server configuration
- TestFlight distribution

### v1.1 (future)
- Live Activity / Dynamic Island showing recording duration
- Silence auto-stop (detect extended silence, prompt to stop)
- Apple Watch complication for quick record start

### Future
- Android app
- Offline browsing (service worker or native cache)
- In-app audio playback with waveform

## Open Questions (Resolved)

1. ~~Apple Developer account~~ — Paid individual, TestFlight distribution
2. ~~Push notifications~~ — Not in v1, poll + local notifications
3. ~~Group selection~~ — Per-recording picker, auto-hidden for single group

## Additional Decisions

1. **Minimum iOS version:** iOS 17+ (covers ~90% of devices, gives access to latest SwiftUI and Observation framework)
2. **Project structure:** Standard Xcode project. No need for SPM multi-package structure at this size
3. **CI/CD:** Build locally from Xcode and upload to TestFlight manually. Automate later with Xcode Cloud if needed — it handles code signing automatically, unlike GitHub Actions where iOS signing is painful to manage
