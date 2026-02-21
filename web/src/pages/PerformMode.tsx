import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router";
import { api } from "../api";
import type { Song } from "../api";
import { transposeChartText, annotateEStringRoots } from "../utils/chordUtils";

const FONT_SIZES = ["text-base", "text-lg", "text-xl", "text-2xl", "text-3xl"];
const SPEED_MULTIPLIERS = [0.5, 0.75, 1, 1.5, 2]; // multipliers around baseline
const TARGET_DURATION = 150; // baseline seconds — tuned so 1x feels natural for a ~3:30 song
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
  const [speedIdx, setSpeedIdx] = useState(() => loadInt(LS_SPEED_KEY, 2, SPEED_MULTIPLIERS.length - 1));
  const [showRoots, setShowRoots] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const scrollAccumRef = useRef<number>(0);
  const headerTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
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

  // Keep speedIdx in a ref so the animation loop always reads the current value
  const speedIdxRef = useRef(speedIdx);
  useEffect(() => { speedIdxRef.current = speedIdx; }, [speedIdx]);

  // Auto-scroll animation loop
  useEffect(() => {
    if (!scrolling) return;
    lastTimeRef.current = 0;
    scrollAccumRef.current = 0;

    function step(timestamp: number) {
      const el = scrollRef.current;
      if (!el) return;

      if (lastTimeRef.current) {
        const dt = (timestamp - lastTimeRef.current) / 1000;

        const scrollable = el.scrollHeight - el.clientHeight;
        const speed = scrollable > 0
          ? (scrollable / TARGET_DURATION) * SPEED_MULTIPLIERS[speedIdxRef.current]
          : 30;

        // Accumulate sub-pixel amounts; only scroll whole pixels
        scrollAccumRef.current += speed * dt;
        if (scrollAccumRef.current >= 1) {
          const px = Math.floor(scrollAccumRef.current);
          scrollAccumRef.current -= px;
          el.scrollTop += px;
        }

        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
          setScrolling(false);
          return;
        }
      }
      lastTimeRef.current = timestamp;
      animRef.current = requestAnimationFrame(step);
    }

    animRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animRef.current);
  }, [scrolling]);

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
    // Ignore taps on the header controls or bottom scroll button
    if ((e.target as HTMLElement).closest("header")) return;
    if ((e.target as HTMLElement).closest("[data-scroll-btn]")) return;

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
  const transposedChart = hasChart ? transposeChartText(song.chart, transpose) : "";
  const chartText = hasChart && showRoots ? annotateEStringRoots(transposedChart) : transposedChart;
  const lyricsText = hasLyrics ? transposeChartText(song.lyrics, transpose) : "";

  return (
    <div
      ref={scrollRef}
      className="h-dvh overflow-y-auto bg-gray-950 text-gray-100"
      onClick={handleBodyTap}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Header — auto-hides during scroll */}
      <header
        className={`sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 px-3 py-2.5 backdrop-blur transition-all duration-300 ${
          headerVisible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
        }`}
      >
        {/* Title row */}
        <div className="flex items-center gap-2">
          <Link
            to={`/songs/${songId}`}
            className="shrink-0 p-2 text-lg text-gray-400 hover:text-white"
            title="Back to song"
          >
            &larr;
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-center text-base font-bold">
            {song.name}
          </h1>
          {(hasChart || hasLyrics) ? (
            <button
              data-scroll-btn
              onClick={(e) => { e.stopPropagation(); setScrolling((s) => !s); }}
              className={`shrink-0 rounded-lg p-2 transition-colors ${
                scrolling
                  ? "text-indigo-400"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}
              title={scrolling ? "Pause scroll" : "Start auto-scroll"}
            >
              {scrolling ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 0 1 .75.75v12a.75.75 0 0 1-1.5 0V6a.75.75 0 0 1 .75-.75Zm10.5 0a.75.75 0 0 1 .75.75v12a.75.75 0 0 1-1.5 0V6a.75.75 0 0 1 .75-.75Z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path fillRule="evenodd" d="M12 3.75a.75.75 0 0 1 .75.75v13.19l5.47-5.47a.75.75 0 1 1 1.06 1.06l-6.75 6.75a.75.75 0 0 1-1.06 0l-6.75-6.75a.75.75 0 1 1 1.06-1.06l5.47 5.47V4.5a.75.75 0 0 1 .75-.75Z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ) : (
            <div className="w-9 shrink-0" />
          )}
        </div>

        {/* Controls row */}
        <div className="mt-2 flex items-center justify-center gap-3">
          {/* Transpose */}
          {hasChart && (
            <div className="flex items-center">
              <button
                onClick={() => setTranspose((t) => ((t - 1) % 12 + 12) % 12)}
                className="rounded-lg px-3 py-2 text-base text-gray-400 active:bg-gray-800 hover:bg-gray-800 hover:text-white"
                title="Transpose down"
              >
                T-
              </button>
              <button
                onClick={() => setTranspose((t) => (t + 1) % 12)}
                className="rounded-lg px-3 py-2 text-base text-gray-400 active:bg-gray-800 hover:bg-gray-800 hover:text-white"
                title="Transpose up"
              >
                T+
              </button>
            </div>
          )}

          {/* Font size */}
          <div className="flex items-center">
            <button
              onClick={() => setFontIdx((i) => Math.max(0, i - 1))}
              disabled={fontIdx === 0}
              className="rounded-lg px-3 py-2 text-base text-gray-400 active:bg-gray-800 hover:bg-gray-800 hover:text-white disabled:opacity-30"
              title="Decrease font size"
            >
              A-
            </button>
            <button
              onClick={() => setFontIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}
              disabled={fontIdx === FONT_SIZES.length - 1}
              className="rounded-lg px-3 py-2 text-base text-gray-400 active:bg-gray-800 hover:bg-gray-800 hover:text-white disabled:opacity-30"
              title="Increase font size"
            >
              A+
            </button>
          </div>

          {/* Scroll speed */}
          <div className="flex items-center">
            <button
              onClick={() => setSpeedIdx((i) => Math.max(0, i - 1))}
              disabled={speedIdx === 0}
              className="rounded-lg px-3 py-2 text-gray-400 active:bg-gray-800 hover:bg-gray-800 hover:text-white disabled:opacity-30"
              title="Slower scroll"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path fillRule="evenodd" d="M9.47 15.28a.75.75 0 0 0 1.06 0l4.25-4.25a.75.75 0 1 0-1.06-1.06L10 13.69 6.28 9.97a.75.75 0 0 0-1.06 1.06l4.25 4.25ZM5.22 6.03l4.25 4.25a.75.75 0 0 0 1.06 0l4.25-4.25a.75.75 0 0 0-1.06-1.06L10 8.69 6.28 4.97a.75.75 0 0 0-1.06 1.06Z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={() => setSpeedIdx((i) => Math.min(SPEED_MULTIPLIERS.length - 1, i + 1))}
              disabled={speedIdx === SPEED_MULTIPLIERS.length - 1}
              className="rounded-lg px-3 py-2 text-gray-400 active:bg-gray-800 hover:bg-gray-800 hover:text-white disabled:opacity-30"
              title="Faster scroll"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path fillRule="evenodd" d="M9.47 4.72a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 1 1-1.06 1.06L10 6.31l-3.72 3.72a.75.75 0 1 1-1.06-1.06l4.25-4.25Zm-4.25 9.25 4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 1 1-1.06 1.06L10 11.31l-3.72 3.72a.75.75 0 0 1-1.06-1.06Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* Root notes toggle */}
          {hasChart && (
            <button
              onClick={() => setShowRoots((v) => !v)}
              className={`rounded-lg px-3 py-2 text-base active:bg-gray-800 ${
                showRoots ? "text-indigo-400" : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}
              title={showRoots ? "Hide root note frets" : "Show root note frets"}
            >
              #
            </button>
          )}
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
