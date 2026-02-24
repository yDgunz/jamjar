import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router";
import { api } from "../api";
import type { Song } from "../api";
import { transposeChartText, annotateEStringRoots } from "../utils/chordUtils";

const FONT_SIZES = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl"];
const SPEED_MULTIPLIERS = [0.5, 0.75, 1, 1.5, 2, 3, 4]; // multipliers around baseline
const TARGET_DURATION = 150; // baseline seconds — tuned so 1x feels natural for a ~3:30 song
const LS_FONT_KEY = "perform-font-size";
const LS_SPEED_KEY = "perform-scroll-speed";
const LS_WRAP_KEY = "perform-wrap-text";

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
  const [fontIdx, setFontIdx] = useState(() => loadInt(LS_FONT_KEY, 4, FONT_SIZES.length - 1));
  const [transpose, setTranspose] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(() => loadInt(LS_SPEED_KEY, 2, SPEED_MULTIPLIERS.length - 1));
  const [showRoots, setShowRoots] = useState(false);
  const [wrapText, setWrapText] = useState(() => localStorage.getItem(LS_WRAP_KEY) !== "0");
  const [headerVisible, setHeaderVisible] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const offsetRef = useRef<number>(0);
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
  useEffect(() => { localStorage.setItem(LS_WRAP_KEY, wrapText ? "1" : "0"); }, [wrapText]);

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

  // Auto-scroll via GPU-composited transforms for smooth sub-pixel scrolling.
  // During auto-scroll: overflow is hidden, content moves via translateY().
  // On pause/stop: transform offset is converted back to native scrollTop.
  useEffect(() => {
    if (!scrolling) return;
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    // Capture current scroll position, then switch to transform mode
    offsetRef.current = container.scrollTop;
    container.scrollTop = 0;
    container.style.overflow = "hidden";
    content.style.willChange = "transform";
    content.style.transform = `translateY(${-offsetRef.current}px)`;
    lastTimeRef.current = 0;

    function step(timestamp: number) {
      if (!container || !content) return;

      if (lastTimeRef.current) {
        const dt = (timestamp - lastTimeRef.current) / 1000;

        const scrollable = content.offsetHeight - container.clientHeight;
        const speed = scrollable > 0
          ? (scrollable / TARGET_DURATION) * SPEED_MULTIPLIERS[speedIdxRef.current]
          : 30;

        offsetRef.current += speed * dt;

        if (offsetRef.current >= scrollable) {
          // Reached the end — convert back to native scroll
          content.style.willChange = "";
          content.style.transform = "";
          container.style.overflow = "";
          container.scrollTop = scrollable;
          setScrolling(false);
          return;
        }

        content.style.transform = `translateY(${-offsetRef.current}px)`;
      }
      lastTimeRef.current = timestamp;
      animRef.current = requestAnimationFrame(step);
    }

    animRef.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(animRef.current);
      // Convert transform position back to native scroll
      const offset = offsetRef.current;
      content.style.willChange = "";
      content.style.transform = "";
      container.style.overflow = "";
      container.scrollTop = offset;
    };
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

  // Tap body — zone-based scroll controls
  // Bottom third: start scrolling / speed up
  // Middle third: stop scrolling
  // Top third: slow down / show header
  const handleBodyTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // Ignore taps on the header controls or scroll button
    if ((e.target as HTMLElement).closest("header")) return;
    if ((e.target as HTMLElement).closest("[data-scroll-btn]")) return;

    const clientY = "touches" in e ? e.changedTouches[0].clientY : (e as React.MouseEvent).clientY;
    const zone = clientY / window.innerHeight;

    if (scrolling) {
      e.preventDefault();
      if (zone > 2 / 3) {
        // Bottom third — speed up
        setSpeedIdx((i) => Math.min(SPEED_MULTIPLIERS.length - 1, i + 1));
      } else if (zone > 1 / 3) {
        // Middle third — stop
        setScrolling(false);
      } else {
        // Top third — slow down
        setSpeedIdx((i) => Math.max(0, i - 1));
      }
    } else {
      if (zone > 2 / 3) {
        // Bottom third — start scrolling
        setScrolling(true);
      } else if (!headerVisible) {
        // Top or middle — show header if hidden
        setHeaderVisible(true);
      }
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

  const hasSheet = !!song.sheet;
  const transposedSheet = hasSheet ? transposeChartText(song.sheet, transpose) : "";
  const sheetText = hasSheet && showRoots ? annotateEStringRoots(transposedSheet) : transposedSheet;

  return (
    <div
      ref={scrollRef}
      className="h-dvh overflow-y-auto bg-gray-950 text-gray-100"
      onClick={handleBodyTap}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div ref={contentRef}>
      {/* Header — auto-hides during scroll */}
      <header
        className={`sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 px-3 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 backdrop-blur transition-all duration-300 ${
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
          {hasSheet ? (
            <button
              data-scroll-btn
              onClick={(e) => { e.stopPropagation(); setScrolling((s) => !s); }}
              className={`shrink-0 rounded-xl px-4 py-2 text-base font-semibold transition-colors ${
                scrolling
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-200 hover:bg-gray-700 hover:text-white"
              }`}
              title={scrolling ? "Pause scroll" : "Start auto-scroll"}
            >
              {scrolling ? "Pause" : "Scroll"}
            </button>
          ) : (
            <div className="w-9 shrink-0" />
          )}
        </div>

        {/* Controls row */}
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          {hasSheet && (
            <>
              <button
                onClick={() => setTranspose((t) => ((t - 1) % 12 + 12) % 12)}
                className="rounded-lg px-2.5 py-1.5 text-base font-medium text-gray-300 active:bg-gray-800"
                title="Transpose down"
              >
                T-
              </button>
              <button
                onClick={() => setTranspose((t) => (t + 1) % 12)}
                className="rounded-lg px-2.5 py-1.5 text-base font-medium text-gray-300 active:bg-gray-800"
                title="Transpose up"
              >
                T+
              </button>
              <button
                onClick={() => setShowRoots((v) => !v)}
                className={`rounded-lg px-2.5 py-1.5 text-base font-medium active:bg-gray-800 ${
                  showRoots ? "bg-indigo-600/20 text-indigo-400" : "text-gray-300"
                }`}
                title={showRoots ? "Hide root note frets" : "Show root note frets"}
              >
                #
              </button>
              <button
                onClick={() => setWrapText((v) => !v)}
                className={`rounded-lg px-2 py-1.5 active:bg-gray-800 ${
                  wrapText ? "bg-indigo-600/20 text-indigo-400" : "text-gray-300"
                }`}
                title={wrapText ? "Disable word wrap" : "Enable word wrap"}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
                  <polyline points="16 16 14 18 16 20" />
                  <line x1="3" y1="18" x2="10" y2="18" />
                </svg>
              </button>
              <span className="mx-0.5 text-gray-800">|</span>
            </>
          )}
          <button
            onClick={() => setFontIdx((i) => Math.max(0, i - 1))}
            disabled={fontIdx === 0}
            className="rounded-lg px-2.5 py-1.5 text-base font-medium text-gray-300 active:bg-gray-800 disabled:opacity-30"
            title="Decrease font size"
          >
            A-
          </button>
          <button
            onClick={() => setFontIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}
            disabled={fontIdx === FONT_SIZES.length - 1}
            className="rounded-lg px-2.5 py-1.5 text-base font-medium text-gray-300 active:bg-gray-800 disabled:opacity-30"
            title="Increase font size"
          >
            A+
          </button>
          <span className="mx-0.5 text-gray-800">|</span>
          <button
            onClick={() => setSpeedIdx((i) => Math.max(0, i - 1))}
            disabled={speedIdx === 0}
            className="rounded-lg px-2 py-1.5 text-base font-bold leading-none text-gray-300 active:bg-gray-800 disabled:opacity-30"
            title="Slower scroll"
          >
            &#8722;
          </button>
          <span className="min-w-[3ch] text-center text-xs tabular-nums text-gray-400">
            {SPEED_MULTIPLIERS[speedIdx]}&times;
          </span>
          <button
            onClick={() => setSpeedIdx((i) => Math.min(SPEED_MULTIPLIERS.length - 1, i + 1))}
            disabled={speedIdx === SPEED_MULTIPLIERS.length - 1}
            className="rounded-lg px-2 py-1.5 text-base font-bold leading-none text-gray-300 active:bg-gray-800 disabled:opacity-30"
            title="Faster scroll"
          >
            +
          </button>
        </div>
      </header>

      {/* Body */}
      <div className={`p-4 sm:p-6 ${FONT_SIZES[fontIdx]}`}>
        {hasSheet ? (
          <div className="mx-auto max-w-3xl">
            <pre className={`${wrapText ? "whitespace-pre-wrap" : "whitespace-pre overflow-x-auto"} font-mono leading-relaxed text-gray-200`}>
              {sheetText}
            </pre>
          </div>
        ) : (
          <p className="text-gray-500">
            No sheet content to display.{" "}
            <Link to={`/songs/${songId}`} className="text-indigo-400 hover:text-indigo-300">
              Add content
            </Link>{" "}
            first.
          </p>
        )}
      </div>
      </div>

    </div>
  );
}
