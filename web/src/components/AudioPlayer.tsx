import { useRef, useState, useEffect, useCallback } from "react";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

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

export default function AudioPlayer({ src, markers, onPlayStateChange, onTimeUpdate }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const previewTimerRef = useRef<number | null>(null);
  const previewIndexRef = useRef(0);

  const PREVIEW_CLIP_DURATION = 4;
  const PREVIEW_NUM_CLIPS = 5;

  useEffect(() => {
    return () => {
      if (previewTimerRef.current !== null) {
        clearTimeout(previewTimerRef.current);
      }
    };
  }, []);

  // Reset state when src changes
  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    stopPreview();
  }, [src]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewing) stopPreview();
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
  }, [playing, previewing, stopPreview]);

  const restart = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewing) stopPreview();
    audio.currentTime = 0;
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

  const stopPreview = useCallback(() => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setPreviewing(false);
    previewIndexRef.current = 0;
  }, []);

  const playNextClip = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const idx = previewIndexRef.current;
    if (idx >= PREVIEW_NUM_CLIPS) {
      audio.pause();
      stopPreview();
      return;
    }

    const dur = audio.duration;
    if (!dur) return;

    // Evenly space clips, avoiding the very start/end
    const padding = Math.min(dur * 0.05, 3);
    const usable = dur - 2 * padding;
    const step = usable / PREVIEW_NUM_CLIPS;
    const startTime = padding + idx * step;

    audio.currentTime = startTime;
    audio.play();

    previewIndexRef.current = idx + 1;
    previewTimerRef.current = window.setTimeout(() => {
      playNextClip();
    }, PREVIEW_CLIP_DURATION * 1000);
  }, [stopPreview]);

  const startPreview = () => {
    const audio = audioRef.current;
    if (!audio || !duration) return;

    if (previewing) {
      stopPreview();
      audio.pause();
      return;
    }

    if (playing) audio.pause();
    setPreviewing(true);
    previewIndexRef.current = 0;
    playNextClip();
  };

  const skipToNextClip = () => {
    if (!previewing) return;
    // Clear the current timer and immediately play next clip
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    playNextClip();
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
      className="flex items-center gap-3 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
    >
      {/* Restart button */}
      <button
        onClick={restart}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-800 text-gray-400 transition hover:bg-gray-700 hover:text-white"
        title="Back to start"
      >
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
          <rect x="4" y="4" width="3" height="16" />
          <polygon points="20,4 9,12 20,20" />
        </svg>
      </button>

      {/* Play/Pause button */}
      <button
        onClick={togglePlay}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-500"
        title={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg className="ml-0.5 h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </button>

      {/* Preview button */}
      <button
        onClick={startPreview}
        className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition ${
          previewing
            ? "bg-amber-600 text-white hover:bg-amber-500"
            : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        }`}
        title="Preview: play short clips from different parts"
      >
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
          <rect x="2" y="4" width="3" height="16" rx="1" />
          <rect x="7" y="7" width="3" height="10" rx="1" />
          <rect x="12" y="4" width="3" height="16" rx="1" />
          <rect x="17" y="7" width="3" height="10" rx="1" />
        </svg>
        <span>{previewing ? "Stop" : "Preview"}</span>
      </button>

      {/* Skip button (only during preview) */}
      {previewing && (
        <button
          onClick={skipToNextClip}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-600 text-white transition hover:bg-amber-500"
          title="Skip to next clip"
        >
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
            <polygon points="4,3 14,12 4,21" />
            <rect x="16" y="3" width="3" height="18" />
          </svg>
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
        className="relative h-2 flex-1 cursor-pointer rounded-full bg-gray-800"
      >
        <div
          className={`absolute top-0 left-0 h-full rounded-full transition-[width] duration-100 ${
            previewing ? "bg-amber-500" : "bg-indigo-500"
          }`}
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

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => { setPlaying(true); onPlayStateChange?.(true, audioRef.current?.currentTime ?? 0); }}
        onPause={() => { if (!previewing) { setPlaying(false); onPlayStateChange?.(false, audioRef.current?.currentTime ?? 0); } }}
        onEnded={() => { setPlaying(false); stopPreview(); }}
      />
    </div>
  );
}
