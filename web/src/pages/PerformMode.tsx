import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router";
import { api } from "../api";
import type { Song } from "../api";
import { transposeChartText, formatTranspose } from "../utils/chordUtils";

const FONT_SIZES = ["text-base", "text-lg", "text-xl", "text-2xl", "text-3xl"];
const SCROLL_SPEEDS = [20, 35, 55, 80, 120]; // pixels per second
const LS_FONT_KEY = "perform-font-size";
const LS_SPEED_KEY = "perform-scroll-speed";

function loadInt(key: string, def: number, max: number): number {
  const stored = localStorage.getItem(key);
  if (stored !== null) {
    const val = Number(stored);
    if (val >= 0 && val <= max) return val;
  }
  return def;
}

export default function PerformMode() {
  const { id } = useParams<{ id: string }>();
  const songId = Number(id);
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoading] = useState(true);
  const [fontIdx, setFontIdx] = useState(() => loadInt(LS_FONT_KEY, 2, FONT_SIZES.length - 1));
  const [transpose, setTranspose] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(() => loadInt(LS_SPEED_KEY, 2, SCROLL_SPEEDS.length - 1));
  const [headerVisible, setHeaderVisible] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const headerTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const touchStartRef = useRef<{ y: number; time: number } | null>(null);

  useEffect(() => {
    api.getSong(songId).then((s) => {
      setSong(s);
      setLoading(false);
    });
  }, [songId]);

  // Persist settings
  useEffect(() => { localStorage.setItem(LS_FONT_KEY, String(fontIdx)); }, [fontIdx]);
  useEffect(() => { localStorage.setItem(LS_SPEED_KEY, String(speedIdx)); }, [speedIdx]);

  // Screen wake lock
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    try {
      navigator.wakeLock.request("screen").then((wl) => { wakeLock = wl; });
    } catch { /* Wake Lock API not supported */ }
    return () => { wakeLock?.release(); };
  }, []);

  // Auto-scroll animation
  const scrollStep = useCallback((timestamp: number) => {
    if (!scrollRef.current) return;
    if (lastTimeRef.current) {
      const dt = (timestamp - lastTimeRef.current) / 1000;
      scrollRef.current.scrollTop += SCROLL_SPEEDS[speedIdx] * dt;

      // Stop at bottom
      const el = scrollRef.current;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
        setScrolling(false);
        return;
      }
    }
    lastTimeRef.current = timestamp;
    animRef.current = requestAnimationFrame(scrollStep);
  }, [speedIdx]);

  useEffect(() => {
    if (scrolling) {
      lastTimeRef.current = 0;
      animRef.current = requestAnimationFrame(scrollStep);
    } else {
      cancelAnimationFrame(animRef.current);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [scrolling, scrollStep]);

  // Auto-hide header during scroll
  useEffect(() => {
    if (scrolling) {
      headerTimeoutRef.current = setTimeout(() => setHeaderVisible(false), 2000);
    } else {
      clearTimeout(headerTimeoutRef.current);
      setHeaderVisible(true);
    }
    return () => clearTimeout(headerTimeoutRef.current);
  }, [scrolling]);

  // Tap body to pause scrolling / reveal header
  const handleBodyTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // Ignore taps on the header controls
    if ((e.target as HTMLElement).closest("header")) return;

    if (scrolling) {
      e.preventDefault();
      setScrolling(false);
    } else if (!headerVisible) {
      setHeaderVisible(true);
    }
  }, [scrolling, headerVisible]);

  // Swipe-down on body to reveal header when hidden
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { y: e.touches[0].clientY, time: Date.now() };
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || headerVisible) return;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;
    if (dy > 50 && dt < 400) {
      setHeaderVisible(true);
    }
    touchStartRef.current = null;
  }, [headerVisible]);

  if (loading) return (
    <div className="min-h-screen bg-gray-950 p-4">
      <div className="flex items-center gap-3 border-b border-gray-800 pb-3">
        <div className="h-5 w-8 animate-pulse rounded bg-gray-800" />
        <div className="h-6 w-48 animate-pulse rounded bg-gray-800" />
      </div>
      <div className="mt-6 space-y-3">
        <div className="h-4 w-16 animate-pulse rounded bg-gray-800" />
        <div className="h-32 w-full animate-pulse rounded bg-gray-800" />
      </div>
    </div>
  );
  if (!song) return <div className="min-h-screen bg-gray-950 p-4 text-gray-400">Song not found.</div>;

  const hasChart = !!song.chart;
  const hasLyrics = !!song.lyrics;
  const bothPresent = hasChart && hasLyrics;
  const chartText = hasChart ? transposeChartText(song.chart, transpose) : "";
  const lyricsText = hasLyrics ? transposeChartText(song.lyrics, transpose) : "";

  return (
    <div
      ref={scrollRef}
      className="min-h-screen overflow-y-auto bg-gray-950 text-gray-100"
      onClick={handleBodyTap}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header — auto-hides during scroll */}
      <header
        className={`sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 px-4 py-2 backdrop-blur transition-all duration-300 ${
          headerVisible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
        }`}
      >
        {/* Top row: back, title, font size */}
        <div className="flex items-center gap-2">
          <Link
            to={`/songs/${songId}`}
            className="shrink-0 text-gray-400 hover:text-white"
            title="Back to song"
          >
            &larr;
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-center text-base font-bold sm:text-lg">
            {song.name}
          </h1>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              onClick={() => setFontIdx((i) => Math.max(0, i - 1))}
              disabled={fontIdx === 0}
              className="rounded px-1.5 py-1 text-sm text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-30"
              title="Decrease font size"
            >
              A-
            </button>
            <button
              onClick={() => setFontIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}
              disabled={fontIdx === FONT_SIZES.length - 1}
              className="rounded px-1.5 py-1 text-sm text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-30"
              title="Increase font size"
            >
              A+
            </button>
          </div>
        </div>

        {/* Bottom row: transpose + auto-scroll */}
        <div className="mt-1.5 flex items-center justify-between gap-3">
          {/* Transpose */}
          {hasChart && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTranspose((t) => ((t - 1) % 12 + 12) % 12)}
                className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
                title="Transpose down"
              >
                -
              </button>
              <span className="min-w-[3.5rem] text-center text-xs text-gray-500">
                {transpose === 0 ? "Original" : formatTranspose(transpose > 6 ? transpose - 12 : transpose)}
              </span>
              <button
                onClick={() => setTranspose((t) => (t + 1) % 12)}
                className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
                title="Transpose up"
              >
                +
              </button>
              {transpose !== 0 && (
                <button
                  onClick={() => setTranspose(0)}
                  className="ml-1 rounded px-1.5 py-0.5 text-xs text-gray-600 hover:text-gray-400"
                  title="Reset transposition"
                >
                  reset
                </button>
              )}
            </div>
          )}
          {!hasChart && <div />}

          {/* Auto-scroll */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSpeedIdx((i) => Math.max(0, i - 1))}
              disabled={speedIdx === 0}
              className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-30"
              title="Slower scroll"
            >
              &laquo;
            </button>
            <button
              onClick={() => setScrolling((s) => !s)}
              className={`rounded px-2.5 py-0.5 text-xs font-medium ${
                scrolling
                  ? "bg-indigo-600 text-white hover:bg-indigo-500"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}
              title={scrolling ? "Pause scroll" : "Start auto-scroll"}
            >
              {scrolling ? "Pause" : "Scroll"}
            </button>
            <button
              onClick={() => setSpeedIdx((i) => Math.min(SCROLL_SPEEDS.length - 1, i + 1))}
              disabled={speedIdx === SCROLL_SPEEDS.length - 1}
              className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-30"
              title="Faster scroll"
            >
              &raquo;
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div
        className={`p-4 sm:p-6 ${FONT_SIZES[fontIdx]} ${
          bothPresent ? "grid gap-6 sm:grid-cols-2" : ""
        }`}
      >
        {hasChart && (
          <div className={bothPresent ? "" : "mx-auto max-w-3xl"}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Chart
            </h2>
            <pre className="whitespace-pre-wrap font-mono leading-relaxed text-gray-200">
              {chartText}
            </pre>
          </div>
        )}
        {hasLyrics && (
          <div className={bothPresent ? "" : "mx-auto max-w-3xl"}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Lyrics
            </h2>
            <div className="whitespace-pre-wrap leading-relaxed text-gray-200">
              {lyricsText}
            </div>
          </div>
        )}
        {!hasChart && !hasLyrics && (
          <p className="text-gray-500">
            No chart or lyrics to display.{" "}
            <Link to={`/songs/${songId}`} className="text-indigo-400 hover:text-indigo-300">
              Add content
            </Link>{" "}
            first.
          </p>
        )}
      </div>
    </div>
  );
}
