import { useRef, useState, useEffect, useCallback } from "react";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Global coordination: when one player starts, all others pause
const playingAudios = new Set<HTMLAudioElement>();
const pauseAllExcept = (active: HTMLAudioElement) => {
  for (const audio of playingAudios) {
    if (audio !== active) audio.pause();
  }
};

export interface Marker {
  timeSec: number;
  label?: string;
}

interface Props {
  src: string;
  durationSec?: number;
  markers?: Marker[];
  onPlayStateChange?: (playing: boolean, currentTime: number) => void;
  onTimeUpdate?: (currentTime: number) => void;
}

const SKIP_SECONDS = 30;

export default function AudioPlayer({ src, durationSec, markers, onPlayStateChange, onTimeUpdate }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSec ?? 0);

  // Register/unregister audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) playingAudios.add(audio);
    return () => { if (audio) playingAudios.delete(audio); };
  }, []);

  // Reset state when src changes
  useEffect(() => {
    setLoaded(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(durationSec ?? 0);
  }, [src, durationSec]);

  // Load audio src on first interaction
  const ensureLoaded = useCallback(() => {
    const audio = audioRef.current;
    if (!loaded && audio) {
      audio.src = src;
      setLoaded(true);
    }
  }, [loaded, src]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      ensureLoaded();
      audio.play();
    }
  }, [playing, ensureLoaded]);

  const restart = () => {
    const audio = audioRef.current;
    if (!audio) return;
    ensureLoaded();
    audio.currentTime = 0;
  };

  const skipAhead = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + SKIP_SECONDS);
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (audio) {
      setCurrentTime(audio.currentTime);
      onTimeUpdate?.(audio.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (audio) setDuration(audio.duration);
  };

  const seekToClientX = useCallback((clientX: number) => {
    const audio = audioRef.current;
    const bar = progressRef.current;
    if (!audio || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    ensureLoaded();
    audio.currentTime = fraction * duration;
  }, [duration, ensureLoaded]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    seekToClientX(e.clientX);
    if (!playing) audioRef.current?.play();
  };

  const handleTouchSeek = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    seekToClientX(e.touches[0].clientX);
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (e.key === " ") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      audio.currentTime = Math.max(0, audio.currentTime - 5);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    }
  }, [togglePlay]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex flex-wrap items-center gap-3 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500/50"
    >
      {/* Restart button */}
      <button
        onClick={restart}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-800 text-gray-400 transition hover:bg-gray-700 hover:text-white"
        title="Back to start"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
          <rect x="4" y="4" width="3" height="16" />
          <polygon points="20,4 9,12 20,20" />
        </svg>
      </button>

      {/* Play/Pause button */}
      <button
        onClick={togglePlay}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-600 text-white transition hover:bg-accent-500"
        title={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg className="ml-0.5 h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </button>

      {/* Skip ahead button (visible while playing) */}
      {playing && (
        <button
          onClick={skipAhead}
          className="flex h-11 shrink-0 items-center gap-1 rounded-full bg-gray-800 px-3 text-xs font-medium text-gray-400 transition hover:bg-gray-700 hover:text-white"
          title={`Skip ahead ${SKIP_SECONDS}s`}
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <polygon points="2,3 12,12 2,21" />
            <polygon points="12,3 22,12 12,21" />
          </svg>
          <span>{SKIP_SECONDS}s</span>
        </button>
      )}

      {/* Time display */}
      <span className="w-20 shrink-0 text-xs tabular-nums text-gray-500">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      {/* Progress bar */}
      <div
        ref={progressRef}
        onClick={handleSeek}
        onTouchStart={handleTouchSeek}
        onTouchMove={handleTouchSeek}
        className="relative basis-full cursor-pointer py-3 sm:basis-0 sm:flex-1"
      >
        <div className="relative h-2 rounded-full bg-gray-800">
          <div
            className="absolute top-0 left-0 h-full rounded-full bg-accent-500 transition-[width] duration-100"
            style={{ width: `${progress}%` }}
          />
          {/* Take boundary markers */}
          {markers && duration > 0 && markers.map((m, i) => (
            <div
              key={i}
              className="absolute top-0 h-full w-0.5 bg-gray-500/60"
              style={{ left: `${(m.timeSec / duration) * 100}%` }}
              title={m.label ?? `${formatTime(m.timeSec)}`}
            />
          ))}
        </div>
      </div>

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => { pauseAllExcept(audioRef.current!); setPlaying(true); onPlayStateChange?.(true, audioRef.current?.currentTime ?? 0); }}
        onPause={() => { setPlaying(false); onPlayStateChange?.(false, audioRef.current?.currentTime ?? 0); }}
        onEnded={() => { setPlaying(false); }}
      />
    </div>
  );
}
