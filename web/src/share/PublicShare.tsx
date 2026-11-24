import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { formatDate } from "../api";
import type { SessionKind, SongBackground, SongLink, SongLinkKind } from "../api";
import AudioPlayer from "../components/AudioPlayer";
import ChordSheet from "../components/ChordSheet";
import KindBadge from "../components/KindBadge";
import SongAbout from "../components/SongAbout";
import SongVideos from "../components/SongVideos";

// What GET /api/share/{token} returns (no auth; the token is the credential)

interface PublicTrack {
  id: number;
  track_number: number;
  title: string;
  duration_sec: number;
  audio_url: string;
  download_url: string;
}

interface PublicSong {
  id: number;
  name: string;
  artist: string;
  sheet: string;
  tab: string;
  background: SongBackground | null;
  links: { id: number; kind: SongLinkKind; url: string; title: string }[];
}

interface PublicShareData {
  kind: "track" | "session" | "setlist" | "song";
  expires_at: string | null;
  track?: PublicTrack & { session_name: string; date: string | null };
  session?: { name: string; date: string | null; kind: SessionKind; tracks: PublicTrack[] };
  setlist?: {
    name: string;
    date: string | null;
    songs: { position: number; song_id: number; name: string; artist: string; has_sheet: boolean }[];
  };
  song?: PublicSong;
}

class LoadError extends Error {
  status: number;
  constructor(status: number) {
    super(String(status));
    this.status = status;
  }
}

async function getJson<T>(url: string): Promise<T> {
  // Plain fetch: no cookies, and no redirect to /login on 401 like the app's client
  const resp = await fetch(url, { credentials: "omit" });
  if (!resp.ok) throw new LoadError(resp.status);
  return resp.json();
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Public page for a share link: a take, a recording, a setlist (and its charts) or a song. */
export default function PublicShare() {
  const { token = "", songId } = useParams();
  const [data, setData] = useState<PublicShareData | null>(null);
  const [song, setSong] = useState<PublicSong | null>(null);
  const [error, setError] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getJson<PublicShareData>(`/api/share/${encodeURIComponent(token)}`).then(
      (d) => { if (!cancelled) setData(d); },
      (e) => { if (!cancelled) setError(e instanceof LoadError ? e.status : 0); },
    );
    return () => { cancelled = true; };
  }, [token]);

  // A chart opened from a shared setlist
  useEffect(() => {
    if (!songId) { setSong(null); return; }
    let cancelled = false;
    setSong(null);
    getJson<PublicSong>(`/api/share/${encodeURIComponent(token)}/songs/${encodeURIComponent(songId)}`).then(
      (s) => { if (!cancelled) setSong(s); },
      (e) => { if (!cancelled) setError(e instanceof LoadError ? e.status : 0); },
    );
    window.scrollTo(0, 0);
    return () => { cancelled = true; };
  }, [token, songId]);

  const title =
    song?.name ?? data?.track?.title ?? data?.session?.name ?? data?.setlist?.name ?? data?.song?.name;
  useEffect(() => {
    document.title = title ? `${title} – JamJar` : "JamJar";
  }, [title]);

  let body: React.ReactNode;
  if (error !== null) {
    body = (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold text-white">
          {error === 410 ? "This link has expired" : error === 404 ? "Link not found" : "Couldn't load this link"}
        </h1>
        <p className="mt-2 text-[15px] text-gray-400">
          {error === 410
            ? "Ask whoever shared it to send a new one."
            : error === 404
              ? "It may have been turned off, or the address is incomplete."
              : "Check your connection and try again."}
        </p>
      </div>
    );
  } else if (!data || (songId && !song)) {
    body = (
      <div className="space-y-3 pt-2">
        <div className="h-8 w-2/3 animate-pulse rounded bg-white/[0.06]" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-white/[0.06]" />
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
      </div>
    );
  } else if (songId && song && data.setlist) {
    body = (
      <>
        <Link to={`/share/${token}`} className="-ml-1 inline-flex items-center text-[15px] text-accent-400 active:opacity-70">
          ‹ {data.setlist.name}
        </Link>
        <SongView song={song} />
      </>
    );
  } else if (data.track) {
    body = <TrackView track={data.track} />;
  } else if (data.session) {
    body = <SessionView session={data.session} />;
  } else if (data.setlist) {
    body = <SetlistView token={token} setlist={data.setlist} />;
  } else if (data.song) {
    body = <SongView song={data.song} />;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-[max(1rem,var(--safe-top))]">
        {body}
      </main>
      <footer className="pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-center text-xs text-gray-600">
        <a href="/" className="inline-flex items-center gap-1.5 hover:text-gray-400">
          <img src="/logo.png" alt="" className="h-4 w-4 opacity-70" />
          Shared from JamJar
        </a>
      </footer>
    </div>
  );
}

function Title({ children, meta }: { children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="mb-4 pt-2">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white">{children}</h1>
      {meta && <div className="mt-1 text-[15px] text-gray-400">{meta}</div>}
    </div>
  );
}

function TrackView({ track }: { track: NonNullable<PublicShareData["track"]> }) {
  return (
    <>
      <Title meta={[track.session_name, track.date ? formatDate(track.date) : null].filter(Boolean).join(" · ")}>
        {track.title}
      </Title>
      <AudioPlayer src={track.audio_url} durationSec={track.duration_sec} downloadUrl={track.download_url} />
    </>
  );
}

function SessionView({ session }: { session: NonNullable<PublicShareData["session"]> }) {
  const [current, setCurrent] = useState<PublicTrack | null>(session.tracks[0] ?? null);
  return (
    <>
      <Title
        meta={
          <>
            {session.date ? formatDate(session.date) : null}
            <KindBadge kind={session.kind} className={session.date ? "ml-2" : ""} />
          </>
        }
      >
        {session.name}
      </Title>
      {current && (
        <div className="sticky top-[var(--safe-top)] z-10 -mx-4 bg-gray-950/95 px-4 pb-3 pt-2 backdrop-blur">
          <div className="mb-1 truncate text-sm font-medium text-white">{current.title}</div>
          {/* key: a fresh player per track, so it starts at the beginning */}
          <AudioPlayer key={current.id} src={current.audio_url} durationSec={current.duration_sec} downloadUrl={current.download_url} />
        </div>
      )}
      <ul className="divide-y divide-white/[0.07]">
        {session.tracks.map((t) => {
          const active = current?.id === t.id;
          return (
            <li key={t.id} className="flex items-center gap-2">
              <button onClick={() => setCurrent(t)} className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left active:opacity-70">
                <span className={`w-6 shrink-0 text-right text-sm tabular-nums ${active ? "text-accent-400" : "text-gray-500"}`}>{t.track_number}</span>
                <span className={`min-w-0 flex-1 truncate text-[17px] sm:text-base ${active ? "font-medium text-accent-400" : "text-white"}`}>{t.title}</span>
                <span className="shrink-0 text-sm tabular-nums text-gray-500">{formatDuration(t.duration_sec)}</span>
              </button>
              <a
                href={t.download_url}
                className="shrink-0 rounded-full p-2 text-gray-500 hover:bg-white/10 hover:text-white"
                aria-label={`Download ${t.title}`}
                title="Download"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function SetlistView({ token, setlist }: { token: string; setlist: NonNullable<PublicShareData["setlist"]> }) {
  return (
    <>
      <Title meta={[setlist.date ? formatDate(setlist.date) : null, `${setlist.songs.length} songs`].filter(Boolean).join(" · ")}>
        {setlist.name}
      </Title>
      <ol className="divide-y divide-white/[0.07]">
        {setlist.songs.map((s, i) => {
          const inner = (
            <>
              <span className="w-6 shrink-0 text-right text-sm tabular-nums text-gray-500">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] text-white sm:text-base">{s.name}</span>
                {s.artist && <span className="block truncate text-sm text-gray-500">{s.artist}</span>}
              </span>
              {s.has_sheet ? (
                <span className="shrink-0 text-sm text-accent-400">Chart ›</span>
              ) : (
                <span className="shrink-0 text-sm text-gray-600">No chart</span>
              )}
            </>
          );
          return (
            <li key={`${s.position}-${s.song_id}`}>
              {s.has_sheet ? (
                <Link to={`/share/${token}/songs/${s.song_id}`} className="flex items-center gap-3 py-3 active:opacity-70">{inner}</Link>
              ) : (
                <div className="flex items-center gap-3 py-3">{inner}</div>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

type SongTabKey = "chart" | "tab" | "about";

function SongView({ song }: { song: PublicSong }) {
  const tabs: SongTabKey[] = [
    "chart",
    ...(song.tab ? (["tab"] as const) : []),
    ...(song.background ? (["about"] as const) : []),
  ];
  const [tab, setTab] = useState<SongTabKey>("chart");
  const links: SongLink[] = song.links.map((l) => ({ ...l, created_by_name: null }));
  return (
    <>
      <Title meta={song.artist || undefined}>{song.name}</Title>
      {tabs.length > 1 && (
        <div className="mb-2 flex gap-1">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${tab === t ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}
            >
              {t === "chart" ? "Chart" : t === "tab" ? "Tab" : "About"}
            </button>
          ))}
        </div>
      )}
      {tab === "chart" ? (
        <>
          <SongVideos links={links} canEdit={false} onAdd={() => {}} onRemove={() => {}} />
          <div className={links.length > 0 ? "mt-6" : ""} />
          {song.sheet ? (
            <div className="text-[17px]">
              <ChordSheet text={song.sheet} wrapText />
            </div>
          ) : (
            <p className="rounded-xl bg-white/[0.04] px-6 py-10 text-center text-[15px] text-gray-400">No chart for this song yet.</p>
          )}
        </>
      ) : tab === "tab" ? (
        <div className="mt-5 text-[17px]">
          <ChordSheet text={song.tab} wrapText />
        </div>
      ) : song.background ? (
        <SongAbout background={song.background} />
      ) : null}
    </>
  );
}
