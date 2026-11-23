const BASE = "/api";

/** Format a YYYY-MM-DD date string as "Thu 2/13/26". Returns the input if unparseable. */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "Z");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Compact date for lists: "Feb 11" (this year) or "Feb 11, 2025". */
export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const parts = dateStr.substring(0, 10).split("-");
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts.map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Full readable date: "Wednesday, Feb 11" (this year) or "Wed, Feb 11, 2025". */
export function formatLongDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown date";
  const parts = dateStr.substring(0, 10).split("-");
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts.map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear
    ? { weekday: "long", month: "short", day: "numeric" }
    : { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export type SongActivityEvent = "opened" | "performed";
const ACTIVITY_KEY = "song-activity";

/** Locally remembered activity, so lists reflect it before the server copy refreshes. */
export function localSongActivity(): Record<number, Partial<Record<SongActivityEvent, string>>> {
  try {
    return JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Record that you opened/performed a song (fire-and-forget). */
export function recordSongActivity(songId: number, event: SongActivityEvent) {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  try {
    const all = localSongActivity();
    all[songId] = { ...all[songId], [event]: now };
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
  fetch(`/api/songs/${songId}/activity`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
  }).catch(() => {});
}

/** "just now", "5m ago", "3h ago", "2d ago", else "Feb 11" — for UTC "YYYY-MM-DD HH:MM:SS". */
export function formatRelative(utc: string | null | undefined): string {
  if (!utc) return "";
  const t = Date.parse(utc.replace(" ", "T") + "Z");
  if (isNaN(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.floor(mins / 1440)}d ago`;
  return formatShortDate(new Date(t).toISOString().slice(0, 10));
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown date";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const shortYear = y.slice(-2);
  return `${days[date.getDay()]} ${Number(m)}/${Number(d)}/${shortYear}`;
}

/**
 * Convert a local time (HH:MM) + date (YYYY-MM-DD) to UTC for storage.
 * Returns { date, time } in UTC.
 */
export function localToUtc(
  date: string,
  time: string,
): { date: string; time: string } {
  const local = new Date(`${date}T${time}:00`);
  const utcDate = local.toISOString().slice(0, 10);
  const utcTime = local.toISOString().slice(11, 16);
  return { date: utcDate, time: utcTime };
}

/**
 * Convert a UTC time (HH:MM) + date (YYYY-MM-DD) to local for display.
 * Returns { date, time } in local timezone.
 */
export function utcToLocal(
  date: string,
  time: string,
): { date: string; time: string } {
  const utc = new Date(`${date}T${time}:00Z`);
  const y = utc.getFullYear();
  const m = String(utc.getMonth() + 1).padStart(2, "0");
  const d = String(utc.getDate()).padStart(2, "0");
  const h = String(utc.getHours()).padStart(2, "0");
  const min = String(utc.getMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${d}`, time: `${h}:${min}` };
}

/** Format a UTC HH:MM time for display in local timezone, e.g. "7:00 PM" */
export function formatTime(
  date: string,
  time: string | null,
): string {
  if (!time) return "";
  const utc = new Date(`${date}T${time}:00Z`);
  return utc.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface AuthGroup {
  id: number;
  name: string;
  features: string[];
}

/** Check if any of the user's groups have a given feature enabled */
export function hasFeature(
  user: AuthUser | null,
  feature: string,
): boolean {
  if (!user) return false;
  return user.groups.some((g) => g.features.includes(feature));
}

export type Role = "superadmin" | "admin" | "editor" | "readonly";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  groups: AuthGroup[];
}

const ROLE_LEVEL: Record<Role, number> = { readonly: 0, editor: 1, admin: 2, superadmin: 3 };

export function hasRole(user: AuthUser | null, minRole: Role): boolean {
  if (!user) return false;
  return (ROLE_LEVEL[user.role] ?? 0) >= ROLE_LEVEL[minRole];
}

export function canEdit(user: AuthUser | null): boolean {
  return hasRole(user, "editor");
}

export function canAdmin(user: AuthUser | null): boolean {
  return hasRole(user, "admin");
}

export function isSuperAdmin(user: AuthUser | null): boolean {
  return hasRole(user, "superadmin");
}

export interface Session {
  id: number;
  group_id: number;
  group_name: string;
  name: string;
  date: string | null;
  source_file: string;
  duration_sec: number | null;
  notes: string;
  track_count: number;
  tagged_count: number;
  song_names: string;
  active_job_id: string | null;
  created_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
}

export interface Track {
  id: number;
  session_id: number;
  song_id: number | null;
  song_name: string | null;
  track_number: number;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  notes: string;
}

export interface SongGroup {
  id: number;
  name: string;
  /** How this band plays the song (key, arrangement, ...) */
  notes: string;
}

export type SongLinkKind = "lesson" | "backing_track" | "other";

export interface SongLink {
  id: number;
  kind: SongLinkKind;
  url: string;
  title: string;
  created_by_name: string | null;
}

export interface SongBackground {
  /** Paragraph whose [n] markers cite sources[n-1] */
  text: string;
  sources: { title: string; url: string }[];
}

export interface Song {
  id: number;
  /** Home band (compat); `groups` lists every band of yours that plays it */
  group_id: number;
  group_name: string;
  groups: SongGroup[];
  /** Reference videos: how-to lessons, backing tracks */
  links: SongLink[];
  /** Short written history of the song ("About" tab); null when there is none */
  background: SongBackground | null;
  /** Your own activity, UTC "YYYY-MM-DD HH:MM:SS" (null if never) */
  last_opened_at: string | null;
  last_performed_at: string | null;
  name: string;
  artist: string;
  sheet: string;
  notes: string;
  take_count: number;
  first_date: string | null;
  last_date: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
}

export interface SongTrack {
  id: number;
  session_id: number;
  track_number: number;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  notes: string;
  session_date: string | null;
  source_file: string;
  session_name: string;
}

export interface Job {
  id: string;
  type: string;
  group_id: number;
  status: "pending" | "processing" | "completed" | "failed";
  progress: string;
  session_id: number | null;
  error: string | null;
}

export interface DriveInfo {
  configured: boolean;
  service_account_email: string | null;
}

export interface DriveFolder {
  id: number;
  folder_id: string;
  name: string;
  group_id: number | null;
  group_name: string | null;
  created_at: string;
}

export interface DriveFile {
  id: string;
  name: string;
  /** Subfolder names below the linked folder */
  path: string[];
  size: number;
  created_time: string | null;
  modified_time: string | null;
  suggested_date: string | null;
  status: "new" | "imported" | "skipped" | "duplicate";
  session_id: number | null;
  session_name: string | null;
}

export interface UploadInitResponse {
  upload_url: string | null;
  r2_key: string | null;
  job: Job;
  session_id: number;
}

export interface Setlist {
  id: number;
  group_id: number;
  group_name: string;
  name: string;
  date: string | null;
  notes: string;
  song_count: number;
  created_by_name: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
}

export interface SetlistSong {
  position: number;
  song_id: number;
  song_name: string;
  artist: string;
  sheet: string;
  added_by_name: string | null;
}

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: string;
  groups: { id: number; name: string }[];
}

export interface AdminGroup {
  id: number;
  name: string;
  member_count: number;
  features: string[];
}

export interface UsageStatsUser {
  id: number;
  email: string;
  name: string;
  last_active_at: string | null;
  event_counts: Record<string, number>;
}

export interface UsageStatsActivity {
  user_name: string;
  event_type: string;
  detail: string | null;
  created_at: string;
}

export interface StorageUsage {
  backend: "r2" | "local";
  bucket: string | null;
  total_objects: number;
  total_bytes: number;
  recordings_source_bytes: number;
  recordings_track_bytes: number;
  prefixes: { prefix: string; objects: number; bytes: number }[];
  /** Files in storage that no session or track points at */
  orphans: { objects: number; bytes: number };
  /** DB paths with no file in storage */
  missing_files: number;
  recordings: {
    id: number;
    name: string;
    date: string | null;
    group_name: string | null;
    duration_sec: number | null;
    source_bytes: number | null;
    track_bytes: number;
    track_count: number;
    total_bytes: number;
  }[];
  computed_at: string;
}

export interface CurationRun {
  id: number;
  summary: string;
  /** action: added_song | added_lesson | added_backing_track | added_background */
  items: { song_id: number | null; song_name: string; action: string }[];
  created_at: string;
}

export interface UsageStats {
  users: UsageStatsUser[];
  recent_activity: UsageStatsActivity[];
  totals: { sessions: number; songs: number; setlists: number };
}

export interface ServerHealthSystem {
  hostname: string;
  platform: string;
  python_version: string;
  time: string;
}

export interface ServerHealthApp {
  uptime_seconds: number;
  port: number;
  data_dir: string;
}

export interface ServerHealthMemory {
  total_mb: number;
  used_mb: number;
  percent: number;
}

export interface ServerHealthDisk {
  mount: string;
  total_gb: number;
  used_gb: number;
  percent: number;
}

export interface ServerHealthUptime {
  seconds: number;
}

export interface ServerHealthDB {
  size_mb: number;
  counts: Record<string, number>;
}

export interface ServerHealthStorage {
  backend: string;
}

export interface ServerHealth {
  system: ServerHealthSystem;
  app: ServerHealthApp;
  memory: ServerHealthMemory;
  disk: ServerHealthDisk[];
  uptime: ServerHealthUptime;
  database: ServerHealthDB;
  storage: ServerHealthStorage;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 3000]; // 1s, 3s

function isRetryable(method: string, status: number, isNetworkError: boolean): boolean {
  if (isNetworkError) return true;
  // Only retry GET requests on server errors
  if (method === "GET" && status >= 500) return true;
  return false;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        ...init,
        credentials: "include",
      });
      if (resp.status === 401) {
        if (!window.location.pathname.startsWith("/login") && navigator.onLine) {
          window.location.href = "/login";
        }
        throw new ApiError("Authentication required", 401);
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        const detail = body?.detail;
        const error = new ApiError(detail || `${resp.status} ${resp.statusText}`, resp.status);
        if (attempt < MAX_RETRIES && isRetryable(method, resp.status, false)) {
          lastError = error;
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }
        throw error;
      }
      return resp.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      // Network error (fetch itself failed)
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES && isRetryable(method, 0, true)) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      throw new ApiError("Network error — check your connection", 0);
    }
  }
  throw lastError ?? new ApiError("Request failed", 0);
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    fetchJson<AuthUser>(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),

  getMe: () => fetchJson<AuthUser>(`${BASE}/auth/me`),

  logout: () =>
    fetch(`${BASE}/auth/logout`, { method: "POST", credentials: "include" }),

  changePassword: (currentPassword: string, newPassword: string) =>
    fetchJson<{ ok: boolean }>(`${BASE}/auth/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),

  // Sessions
  listSessions: () => fetchJson<Session[]>(`${BASE}/sessions`),

  getSession: (id: number) => fetchJson<Session>(`${BASE}/sessions/${id}`),

  getSessionTracks: (id: number) => fetchJson<Track[]>(`${BASE}/sessions/${id}/tracks`),

  updateSessionName: (id: number, name: string) =>
    fetchJson<Session>(`${BASE}/sessions/${id}/name`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  updateSessionNotes: (id: number, notes: string) =>
    fetchJson<Session>(`${BASE}/sessions/${id}/notes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    }),

  updateSessionDate: (id: number, date: string | null) =>
    fetchJson<Session>(`${BASE}/sessions/${id}/date`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    }),

  updateSessionGroup: (id: number, groupId: number) =>
    fetchJson<Session>(`${BASE}/sessions/${id}/group`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId }),
    }),

  tagTrack: (trackId: number, songName: string) =>
    fetchJson<Track>(`${BASE}/tracks/${trackId}/tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_name: songName }),
    }),

  untagTrack: (trackId: number) =>
    fetch(`${BASE}/tracks/${trackId}/tag`, { method: "DELETE", credentials: "include" }),

  updateTrackNotes: (trackId: number, notes: string) =>
    fetchJson<Track>(`${BASE}/tracks/${trackId}/notes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    }),

  mergeTrack: (trackId: number, otherTrackId: number) =>
    fetchJson<Track[]>(`${BASE}/tracks/${trackId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ other_track_id: otherTrackId }),
    }),

  splitTrack: (trackId: number, splitAtSec: number) =>
    fetchJson<Track[]>(`${BASE}/tracks/${trackId}/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ split_at_sec: splitAtSec }),
    }),

  trimTrack: (trackId: number, startDelta?: number, endDelta?: number) =>
    fetchJson<Track>(`${BASE}/tracks/${trackId}/trim`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_delta: startDelta ?? 0,
        end_delta: endDelta ?? 0,
      }),
    }),

  reprocessSession: (sessionId: number, threshold: number, minDuration: number, single?: boolean) =>
    fetchJson<Job>(`${BASE}/sessions/${sessionId}/reprocess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threshold, min_duration: minDuration, ...(single ? { single: true } : {}) }),
    }),

  /** Replace a recording's tracks with hand-marked [start, end] songs (seconds). */
  splitSessionManually: (sessionId: number, segments: [number, number][]) =>
    fetchJson<Job>(`${BASE}/sessions/${sessionId}/reprocess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments }),
    }),

  deleteSession: (id: number, deleteFiles = false) =>
    fetchJson<{ ok: boolean }>(`${BASE}/sessions/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete_files: deleteFiles }),
    }),

  trackAudioUrl: (trackId: number) => `${BASE}/tracks/${trackId}/audio`,

  sessionAudioUrl: (sessionId: number) => `${BASE}/sessions/${sessionId}/audio`,

  // Songs
  listSongs: (groupId?: number) =>
    fetchJson<Song[]>(`${BASE}/songs${groupId != null ? `?group_id=${groupId}` : ""}`),

  createSong: (name: string, groupId: number, artist?: string) =>
    fetchJson<Song>(`${BASE}/songs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, group_id: groupId, ...(artist ? { artist } : {}) }),
    }),

  getSong: (songId: number) => fetchJson<Song>(`${BASE}/songs/${songId}`),

  updateSongDetails: (
    songId: number,
    details: { artist: string; sheet: string; notes: string },
  ) =>
    fetchJson<Song>(`${BASE}/songs/${songId}/details`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(details),
    }),

  fetchLyrics: (songId: number) =>
    fetchJson<{ lyrics: string; song: Song }>(`${BASE}/songs/${songId}/fetch-lyrics`, {
      method: "POST",
    }),

  renameSong: (songId: number, name: string) =>
    fetchJson<Song>(`${BASE}/songs/${songId}/name`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  updateSongGroup: (songId: number, groupId: number) =>
    fetchJson<Song>(`${BASE}/songs/${songId}/group`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId }),
    }),

  linkSongGroup: (songId: number, groupId: number) =>
    fetchJson<Song>(`${BASE}/songs/${songId}/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId }),
    }),

  unlinkSongGroup: (songId: number, groupId: number) =>
    fetchJson<Song>(`${BASE}/songs/${songId}/groups/${groupId}`, { method: "DELETE" }),

  setSongGroupNotes: (songId: number, groupId: number, notes: string) =>
    fetchJson<Song>(`${BASE}/songs/${songId}/groups/${groupId}/notes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    }),

  addSongLink: (songId: number, url: string, kind: SongLinkKind, title = "") =>
    fetchJson<Song>(`${BASE}/songs/${songId}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, kind, title }),
    }),

  deleteSongLink: (songId: number, linkId: number) =>
    fetchJson<Song>(`${BASE}/songs/${songId}/links/${linkId}`, { method: "DELETE" }),

  deleteSong: (songId: number) =>
    fetchJson<{ ok: boolean }>(`${BASE}/songs/${songId}`, { method: "DELETE" }),

  getSongTracks: (songId: number) =>
    fetchJson<SongTrack[]>(`${BASE}/songs/${songId}/tracks`),

  uploadSession: (
    file: File,
    groupId?: number,
    threshold?: number,
    single?: boolean,
    force?: boolean,
    onProgress?: (pct: number) => void,
  ): Promise<Job> => {
    const form = new FormData();
    form.append("file", file);
    const params = new URLSearchParams();
    if (groupId !== undefined) params.set("group_id", String(groupId));
    if (threshold !== undefined) params.set("threshold", String(threshold));
    if (single) params.set("single", "true");
    if (force) params.set("force", "true");
    const qs = params.toString();
    const url = `${BASE}/sessions/upload${qs ? `?${qs}` : ""}`;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.withCredentials = true;

      if (onProgress) {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
      }

      xhr.addEventListener("load", () => {
        if (xhr.status === 401) {
          if (!window.location.pathname.startsWith("/login") && navigator.onLine) {
            window.location.href = "/login";
          }
          reject(new ApiError("Authentication required", 401));
          return;
        }
        let body: any;
        try { body = JSON.parse(xhr.responseText); } catch { body = null; }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body as Job);
        } else {
          reject(new ApiError(body?.detail || `${xhr.status} ${xhr.statusText}`, xhr.status));
        }
      });

      xhr.addEventListener("error", () => {
        reject(new ApiError("Network error", 0));
      });

      xhr.send(form);
    });
  },

  initUpload: (
    filename: string,
    groupId?: number,
    threshold?: number,
    single?: boolean,
    force?: boolean,
  ) =>
    fetchJson<UploadInitResponse>(`${BASE}/sessions/upload/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        ...(groupId !== undefined && { group_id: groupId }),
        ...(threshold !== undefined && { threshold }),
        ...(single && { single: true }),
        ...(force && { force: true }),
      }),
    }),

  completeUpload: (
    jobId: string,
    sessionId: number,
    threshold?: number,
    single?: boolean,
    force?: boolean,
  ) =>
    fetchJson<Job>(`${BASE}/sessions/upload/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        session_id: sessionId,
        ...(threshold !== undefined && { threshold }),
        ...(single && { single: true }),
        ...(force && { force: true }),
      }),
    }),

  uploadToPresignedUrl: (
    url: string,
    file: File,
    contentType: string,
    onProgress?: (pct: number) => void,
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", contentType);

      if (onProgress) {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
      }

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new ApiError(`Upload failed: ${xhr.status} ${xhr.statusText}`, xhr.status));
        }
      });

      xhr.addEventListener("error", () => {
        reject(new ApiError("Network error during upload", 0));
      });

      xhr.send(file);
    });
  },

  getJob: (jobId: string) => fetchJson<Job>(`${BASE}/jobs/${jobId}`),

  driveInfo: () => fetchJson<DriveInfo>(`${BASE}/drive`),
  driveFolders: () => fetchJson<DriveFolder[]>(`${BASE}/drive/folders`),
  driveAddFolder: (url: string, groupId: number | null) =>
    fetchJson<DriveFolder>(`${BASE}/drive/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, group_id: groupId }),
    }),
  driveSetFolderGroup: (folderId: number, groupId: number | null) =>
    fetchJson<DriveFolder>(`${BASE}/drive/folders/${folderId}/group`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId }),
    }),
  driveRemoveFolder: (folderId: number) =>
    fetchJson<{ ok: boolean }>(`${BASE}/drive/folders/${folderId}`, { method: "DELETE" }),
  driveFiles: (folderId: number) => fetchJson<DriveFile[]>(`${BASE}/drive/folders/${folderId}/files`),
  driveImport: (fileId: string, groupId: number, opts: { single?: boolean } = {}) =>
    fetchJson<Job>(`${BASE}/drive/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId, group_id: groupId, ...opts }),
    }),
  driveSkip: (fileId: string, fileName: string, skipped: boolean) =>
    fetchJson<{ ok: boolean }>(`${BASE}/drive/skip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId, file_name: fileName, skipped }),
    }),

  // Setlists
  listSetlists: () => fetchJson<Setlist[]>(`${BASE}/setlists`),

  createSetlist: (name: string, groupId: number, date?: string, notes?: string) =>
    fetchJson<Setlist>(`${BASE}/setlists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, group_id: groupId, date: date ?? null, notes: notes ?? "" }),
    }),

  getSetlist: (id: number) => fetchJson<Setlist>(`${BASE}/setlists/${id}`),

  getSetlistSongs: (id: number) => fetchJson<SetlistSong[]>(`${BASE}/setlists/${id}/songs`),

  updateSetlistName: (id: number, name: string) =>
    fetchJson<Setlist>(`${BASE}/setlists/${id}/name`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  updateSetlistDate: (id: number, date: string | null) =>
    fetchJson<Setlist>(`${BASE}/setlists/${id}/date`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    }),

  updateSetlistNotes: (id: number, notes: string) =>
    fetchJson<Setlist>(`${BASE}/setlists/${id}/notes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    }),

  setSetlistSongs: (id: number, songIds: number[]) =>
    fetchJson<SetlistSong[]>(`${BASE}/setlists/${id}/songs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_ids: songIds }),
    }),

  addSetlistSong: (id: number, songId: number, position?: number) =>
    fetchJson<SetlistSong[]>(`${BASE}/setlists/${id}/songs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_id: songId, position: position ?? null }),
    }),

  removeSetlistSong: (id: number, position: number) =>
    fetchJson<{ ok: boolean }>(`${BASE}/setlists/${id}/songs/${position}`, {
      method: "DELETE",
    }),

  deleteSetlist: (id: number) =>
    fetchJson<{ ok: boolean }>(`${BASE}/setlists/${id}`, { method: "DELETE" }),

  // Share links
  createShareLink: (trackId: number) =>
    fetchJson<{ token: string; url: string }>(`${BASE}/tracks/${trackId}/share`, {
      method: "POST",
    }),

  deleteShareLink: (trackId: number) =>
    fetchJson<{ ok: boolean }>(`${BASE}/tracks/${trackId}/share`, {
      method: "DELETE",
    }),

  // Admin
  adminListUsers: () => fetchJson<AdminUser[]>(`${BASE}/admin/users`),

  adminCreateUser: (email: string, name: string, role = "editor", groupIds: number[] = []) =>
    fetchJson<AdminUser>(`${BASE}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, role, group_ids: groupIds }),
    }),

  adminDeleteUser: (userId: number) =>
    fetchJson<{ ok: boolean }>(`${BASE}/admin/users/${userId}`, {
      method: "DELETE",
    }),

  adminResetPassword: (userId: number, password: string) =>
    fetchJson<{ ok: boolean }>(`${BASE}/admin/users/${userId}/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),

  adminUpdateName: (userId: number, name: string) =>
    fetchJson<AdminUser>(`${BASE}/admin/users/${userId}/name`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  adminUpdateRole: (userId: number, role: string) =>
    fetchJson<AdminUser>(`${BASE}/admin/users/${userId}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    }),

  adminAssignGroup: (userId: number, groupId: number) =>
    fetchJson<AdminUser>(`${BASE}/admin/users/${userId}/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId }),
    }),

  adminRemoveGroup: (userId: number, groupId: number) =>
    fetchJson<AdminUser>(`${BASE}/admin/users/${userId}/groups/${groupId}`, {
      method: "DELETE",
    }),

  adminListGroups: () => fetchJson<AdminGroup[]>(`${BASE}/admin/groups`),

  adminCreateGroup: (name: string) =>
    fetchJson<AdminGroup>(`${BASE}/admin/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  adminDeleteGroup: (groupId: number) =>
    fetchJson<{ ok: boolean }>(`${BASE}/admin/groups/${groupId}`, {
      method: "DELETE",
    }),

  adminUpdateGroupFeatures: (groupId: number, features: string[]) =>
    fetchJson<AdminGroup>(`${BASE}/admin/groups/${groupId}/features`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features }),
    }),

  adminResendInvite: (userId: number) =>
    fetchJson<{ ok: boolean; email_sent: boolean }>(
      `${BASE}/admin/users/${userId}/resend-invite`,
      { method: "POST" }
    ),

  adminGetUsageStats: () => fetchJson<UsageStats>(`${BASE}/admin/stats`),

  adminGetStorageUsage: (refresh = false) =>
    fetchJson<StorageUsage>(`${BASE}/admin/storage${refresh ? "?refresh=true" : ""}`),

  adminGetCurationRuns: () => fetchJson<CurationRun[]>(`${BASE}/admin/curation-runs`),

  adminGetServerHealth: () => fetchJson<ServerHealth>(`${BASE}/admin/server-health`),

  // Invite (public)
  validateInvite: (token: string) =>
    fetchJson<{ email: string; name: string }>(`${BASE}/invite/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }),

  acceptInvite: (token: string, password: string) =>
    fetchJson<AuthUser>(`${BASE}/invite/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    }),

  // Password reset (public)
  forgotPassword: (email: string) =>
    fetchJson<{ ok: boolean }>(`${BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),

  validateResetToken: (token: string) =>
    fetchJson<{ email: string }>(`${BASE}/auth/reset-password/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }),

  resetPassword: (token: string, password: string) =>
    fetchJson<AuthUser>(`${BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    }),

  // Access request (public)
  requestAccess: (email: string, band_name: string, message: string) =>
    fetchJson<{ ok: boolean; message: string }>(`${BASE}/access-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, band_name, message }),
    }),
};
