const BASE = "/api";

/** Format a YYYY-MM-DD date string as M/d/yy. Returns the input if unparseable. */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown date";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  const shortYear = y.slice(-2);
  return `${parseInt(m)}/${parseInt(d)}/${shortYear}`;
}

export interface Session {
  id: number;
  name: string;
  date: string | null;
  source_file: string;
  notes: string;
  track_count: number;
  tagged_count: number;
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
  fingerprint: string;
  audio_path: string;
  notes: string;
}

export interface Song {
  id: number;
  name: string;
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
  audio_path: string;
  notes: string;
  session_date: string | null;
  source_file: string;
  session_name: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json();
}

export const api = {
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

  tagTrack: (trackId: number, songName: string) =>
    fetchJson<Track>(`${BASE}/tracks/${trackId}/tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ song_name: songName }),
    }),

  untagTrack: (trackId: number) =>
    fetch(`${BASE}/tracks/${trackId}/tag`, { method: "DELETE" }),

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

  reprocessSession: (sessionId: number, threshold: number, minDuration: number) =>
    fetchJson<Track[]>(`${BASE}/sessions/${sessionId}/reprocess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threshold, min_duration: minDuration }),
    }),

  trackAudioUrl: (trackId: number) => `${BASE}/tracks/${trackId}/audio`,

  sessionAudioUrl: (sessionId: number) => `${BASE}/sessions/${sessionId}/audio`,

  listSongs: () => fetchJson<Song[]>(`${BASE}/songs`),

  getSongTracks: (songId: number) =>
    fetchJson<SongTrack[]>(`${BASE}/songs/${songId}/tracks`),
};
