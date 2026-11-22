import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import Artwork from "../components/Artwork";
import { pauseAllExcept, playingAudios } from "../components/AudioPlayer";

/** Something the mini-player can play: a track or a full recording. */
export interface PlayerItem {
  /** Stable identity, e.g. "track:12" or "session:4" */
  key: string;
  src: string;
  title: string;
  subtitle?: string;
  /** Where tapping the title in the mini-player navigates to */
  href?: string;
  durationSec?: number;
  trackId?: number;
  /** Seed for the generated artwork (defaults to `key`) */
  artSeed?: string;
}

interface PlayerState {
  item: PlayerItem | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  /** Start playing an item (or toggle it if it's already loaded). */
  play: (item: PlayerItem) => void;
  toggle: () => void;
  seek: (sec: number) => void;
  skip: (deltaSec: number) => void;
  close: () => void;
  isCurrent: (key: string) => boolean;
}

const PlayerContext = createContext<PlayerState | null>(null);

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return ctx;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [item, setItem] = useState<PlayerItem | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) playingAudios.add(audio);
    return () => { if (audio) playingAudios.delete(audio); };
  }, []);

  const play = useCallback((next: PlayerItem) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (item?.key === next.key) {
      if (audio.paused) audio.play(); else audio.pause();
      return;
    }
    setItem(next);
    setCurrentTime(0);
    setDuration(next.durationSec ?? 0);
    audio.src = next.src;
    audio.play().catch(() => setPlaying(false));
  }, [item]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !item) return;
    if (audio.paused) audio.play(); else audio.pause();
  }, [item]);

  const seek = useCallback((sec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(sec, audio.duration || duration || sec));
    setCurrentTime(audio.currentTime);
  }, [duration]);

  const skip = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (audio) seek(audio.currentTime + delta);
  }, [seek]);

  const close = useCallback(() => {
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    setItem(null);
    setPlaying(false);
  }, []);

  // Lock-screen / headphone controls
  useEffect(() => {
    if (!("mediaSession" in navigator) || !item) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.subtitle ?? "JamJar",
      artwork: [{ src: "/logo.png", sizes: "512x512", type: "image/png" }],
    });
    navigator.mediaSession.setActionHandler("play", () => audioRef.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
    navigator.mediaSession.setActionHandler("seekbackward", () => skip(-15));
    navigator.mediaSession.setActionHandler("seekforward", () => skip(30));
  }, [item, skip]);

  const value = useMemo<PlayerState>(() => ({
    item, playing, currentTime, duration, play, toggle, seek, skip, close,
    isCurrent: (key: string) => item?.key === key,
  }), [item, playing, currentTime, duration, play, toggle, seek, skip, close]);

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => { pauseAllExcept(audioRef.current!); setPlaying(true); }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
      />
    </PlayerContext.Provider>
  );
}

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m}:${s.toString().padStart(2, "0")}`;
}

export function PlayIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" /></svg>
  );
}

export function PauseIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
  );
}

/** Bar pinned above the tab bar while something is loaded. */
export function MiniPlayer() {
  const { item, playing, currentTime, duration, toggle, seek, skip, close } = usePlayer();
  const barRef = useRef<HTMLDivElement>(null);
  if (!item) return null;

  const total = duration || item.durationSec || 0;
  const pct = total > 0 ? Math.min(100, (currentTime / total) * 100) : 0;

  const seekFromEvent = (clientX: number) => {
    const bar = barRef.current;
    if (!bar || !total) return;
    const rect = bar.getBoundingClientRect();
    seek(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * total);
  };

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.6rem+env(safe-area-inset-bottom))] z-40 px-2 sm:bottom-4 sm:mx-auto sm:max-w-3xl sm:px-6">
      <div className="glass overflow-hidden rounded-2xl border border-white/10 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.9)]">
        {/* Seekable progress line (large invisible touch target) */}
        <div
          ref={barRef}
          className="relative h-3 cursor-pointer touch-none"
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); seekFromEvent(e.clientX); }}
          onPointerMove={(e) => { if (e.buttons) seekFromEvent(e.clientX); }}
        >
          <div className="absolute inset-x-0 top-0 h-[3px] bg-white/10">
            <div className="h-full bg-linear-to-r from-accent-400 to-accent-600" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="-mt-1 flex items-center gap-1 pb-2 pl-2 pr-1.5">
          <Artwork seed={item.artSeed ?? item.key} name={item.title} size="xs" className="mr-1.5" />
          <div className="min-w-0 flex-1">
            {item.href ? (
              <Link to={item.href} className="block truncate text-[15px] font-semibold text-white">{item.title}</Link>
            ) : (
              <div className="truncate text-[15px] font-semibold text-white">{item.title}</div>
            )}
            <div className="truncate text-xs text-gray-400">
              <span className="tabular-nums">{formatTime(currentTime)} / {formatTime(total)}</span>
              {item.subtitle && <> · {item.subtitle}</>}
            </div>
          </div>
          <button onClick={() => skip(-15)} aria-label="Back 15 seconds" className="flex h-10 w-10 items-center justify-center rounded-full text-gray-300 active:bg-white/10">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4" /><text x="12" y="15.5" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="600">15</text></svg>
          </button>
          <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="btn-primary h-11 w-11">
            {playing ? <PauseIcon /> : <PlayIcon className="ml-0.5 h-5 w-5" />}
          </button>
          <button onClick={() => skip(30)} aria-label="Forward 30 seconds" className="flex h-10 w-10 items-center justify-center rounded-full text-gray-300 active:bg-white/10">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-3-6.7M21 4v4h-4" /><text x="12" y="15.5" fontSize="7" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="600">30</text></svg>
          </button>
          <button onClick={close} aria-label="Close player" className="flex h-10 w-8 items-center justify-center text-gray-500 active:text-gray-300">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
