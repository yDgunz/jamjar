const BASE = "/api";

/** Format a YYYY-MM-DD date string as "Thu 2/13/26". Returns the input if unparseable. */
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

export interface AuthGroup {
  id: number;
  name: string;
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

export interface Song {
  id: number;
  group_id: number;
  group_name: string;
  name: string;
  artist: string;
  sheet: string;
  notes: string;
  take_count: number;
  first_date: string | null;
  last_date: string | null;
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
}

export interface SetlistSong {
  position: number;
  song_id: number;
  song_name: string;
  artist: string;
  sheet: string;
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
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    credentials: "include",
  });
  if (resp.status === 401) {
    // Redirect to login on auth failure (unless already on login page or offline)
    if (!window.location.pathname.startsWith("/login") && navigator.onLine) {
      window.location.href = "/login";
    }
    throw new ApiError("Authentication required", 401);
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    const detail = body?.detail;
    throw new ApiError(detail || `${resp.status} ${resp.statusText}`, resp.status);
  }
  return resp.json();
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

  reprocessSession: (sessionId: number, threshold: number, minDuration: number, single?: boolean) =>
    fetchJson<Track[]>(`${BASE}/sessions/${sessionId}/reprocess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threshold, min_duration: minDuration, ...(single ? { single: true } : {}) }),
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
  listSongs: () => fetchJson<Song[]>(`${BASE}/songs`),

  createSong: (name: string, groupId: number) =>
    fetchJson<Song>(`${BASE}/songs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, group_id: groupId }),
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

  // Admin
  adminListUsers: () => fetchJson<AdminUser[]>(`${BASE}/admin/users`),

  adminCreateUser: (email: string, password: string, name: string, role = "editor") =>
    fetchJson<AdminUser>(`${BASE}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name, role }),
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
};
