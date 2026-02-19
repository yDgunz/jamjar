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
  markers?: Marker[];
  onPlayStateChange?: (playing: boolean, currentTime: number) => void;
  onTimeUpdate?: (currentTime: number) => void;
}

const SKIP_SECONDS = 30;

export default function AudioPlayer({ src, markers, onPlayStateChange, onTimeUpdate }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Register/unregister audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) playingAudios.add(audio);
    return () => { if (audio) playingAudios.delete(audio); };
  }, []);

  // Reset state when src changes
  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
  }, [playing]);

  const restart = () => {
    const audio = audioRef.current;
    if (!audio) return;
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

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const bar = progressRef.current;
    if (!audio || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = fraction * duration;
    if (!playing) audio.play();
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
      className="flex flex-wrap items-center gap-3 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
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
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-500"
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
            <polygon points="4,3 14,12 4,21" />
            <rect x="16" y="3" width="3" height="18" />
          </svg>
          <span>{SKIP_SECONDS}s</span>
        </button>
      )}

      {/* Time display */}
      <span className="w-20 shrink-0 text-xs tabular-nums text-gray-500">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      {/* Download button */}
      <a
        href={src}
        download
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-800 text-gray-400 transition hover:bg-gray-700 hover:text-white"
        title="Download"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>

      {/* Progress bar — hidden on mobile */}
      <div
        ref={progressRef}
        onClick={handleSeek}
        className="relative hidden flex-1 cursor-pointer py-3 sm:block"
      >
        <div className="relative h-2 rounded-full bg-gray-800">
          <div
            className="absolute top-0 left-0 h-full rounded-full bg-indigo-500 transition-[width] duration-100"
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
        src={src}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => { pauseAllExcept(audioRef.current!); setPlaying(true); onPlayStateChange?.(true, audioRef.current?.currentTime ?? 0); }}
        onPause={() => { setPlaying(false); onPlayStateChange?.(false, audioRef.current?.currentTime ?? 0); }}
        onEnded={() => { setPlaying(false); }}
      />
    </div>
  );
}
