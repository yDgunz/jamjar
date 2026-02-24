import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router";
import { api } from "../api";
import type { Setlist, SetlistSong } from "../api";
import { transposeChartText, annotateEStringRoots } from "../utils/chordUtils";

const FONT_SIZES = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl"];
const SPEED_MULTIPLIERS = [0.5, 0.75, 1, 1.5, 2, 3, 4];
const TARGET_DURATION = 150;
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

export default function SetlistPerformMode() {
  const { id } = useParams<{ id: string }>();
  const setlistId = Number(id);
  const [setlist, setSetlist] = useState<Setlist | null>(null);
  const [songs, setSongs] = useState<SetlistSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
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
    Promise.all([api.getSetlist(setlistId), api.getSetlistSongs(setlistId)]).then(
      ([sl, slSongs]) => {
        setSetlist(sl);
        setSongs(slSongs);
        setLoading(false);
      },
    );
  }, [setlistId]);

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

  const speedIdxRef = useRef(speedIdx);
  useEffect(() => { speedIdxRef.current = speedIdx; }, [speedIdx]);

  // Auto-scroll
  useEffect(() => {
    if (!scrolling) return;
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

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

  // Navigate to song — reset scroll and transpose
  const goToSong = useCallback((idx: number) => {
    if (idx < 0 || idx >= songs.length) return;
    setScrolling(false);
    setCurrentIdx(idx);
    setTranspose(0);
    // Reset scroll position
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    setHeaderVisible(true);
  }, [songs.length]);

  // Tap body — zone-based scroll controls
  const handleBodyTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("header")) return;
    if ((e.target as HTMLElement).closest("[data-scroll-btn]")) return;
    if ((e.target as HTMLElement).closest("[data-nav-btn]")) return;

    const clientY = "touches" in e ? e.changedTouches[0].clientY : (e as React.MouseEvent).clientY;
    const zone = clientY / window.innerHeight;

    if (scrolling) {
      e.preventDefault();
      if (zone > 2 / 3) {
        setSpeedIdx((i) => Math.min(SPEED_MULTIPLIERS.length - 1, i + 1));
      } else if (zone > 1 / 3) {
        setScrolling(false);
      } else {
        setSpeedIdx((i) => Math.max(0, i - 1));
      }
    } else {
      if (zone > 2 / 3) {
        setScrolling(true);
      } else if (!headerVisible) {
        setHeaderVisible(true);
      }
    }
  }, [scrolling, headerVisible]);

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
  if (!setlist || songs.length === 0) return (
    <div className="min-h-screen bg-gray-950 p-4 text-gray-400">
      No songs in this setlist.{" "}
      <Link to={`/setlists/${setlistId}`} className="text-indigo-400">Go back</Link>
    </div>
  );

  const currentSong = songs[currentIdx];
  const hasSheet = !!currentSong?.sheet;
  const transposedSheet = hasSheet ? transposeChartText(currentSong.sheet, transpose) : "";
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
      {/* Header */}
      <header
        className={`sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 px-3 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 backdrop-blur transition-all duration-300 ${
          headerVisible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
        }`}
      >
        {/* Title + nav row */}
        <div className="flex items-center gap-1">
          <Link
            to={`/setlists/${setlistId}`}
            className="shrink-0 p-2 text-lg text-gray-400 hover:text-white"
            title="Back to setlist"
          >
            &larr;
          </Link>
          <button
            data-nav-btn
            onClick={(e) => { e.stopPropagation(); goToSong(currentIdx - 1); }}
            disabled={currentIdx === 0}
            className="shrink-0 rounded-xl bg-gray-800 px-3 py-2.5 text-gray-200 active:bg-gray-700 hover:bg-gray-700 hover:text-white disabled:opacity-25"
            title="Previous song"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6">
              <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="text-xs text-gray-500 tabular-nums">
              {currentIdx + 1}/{songs.length}
            </div>
            <h1 className="truncate text-sm font-bold">
              {currentSong.song_name}
            </h1>
          </div>
          <button
            data-nav-btn
            onClick={(e) => { e.stopPropagation(); goToSong(currentIdx + 1); }}
            disabled={currentIdx === songs.length - 1}
            className="shrink-0 rounded-xl bg-gray-800 px-3 py-2.5 text-gray-200 active:bg-gray-700 hover:bg-gray-700 hover:text-white disabled:opacity-25"
            title="Next song"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6">
              <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </button>
          {hasSheet ? (
            <button
              data-scroll-btn
              onClick={(e) => { e.stopPropagation(); setScrolling((s) => !s); }}
              className={`shrink-0 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
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

        {/* Controls row — compact for mobile */}
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          {hasSheet && (
            <>
              <button
                onClick={() => setTranspose((t) => ((t - 1) % 12 + 12) % 12)}
                className="rounded-lg px-2.5 py-1.5 text-base font-medium text-gray-300 active:bg-gray-800"
              >
                T-
              </button>
              <button
                onClick={() => setTranspose((t) => (t + 1) % 12)}
                className="rounded-lg px-2.5 py-1.5 text-base font-medium text-gray-300 active:bg-gray-800"
              >
                T+
              </button>
              <button
                onClick={() => setShowRoots((v) => !v)}
                className={`rounded-lg px-2.5 py-1.5 text-base font-medium active:bg-gray-800 ${
                  showRoots ? "bg-indigo-600/20 text-indigo-400" : "text-gray-300"
                }`}
              >
                #
              </button>
              <button
                onClick={() => setWrapText((v) => !v)}
                className={`rounded-lg px-2 py-1.5 active:bg-gray-800 ${
                  wrapText ? "bg-indigo-600/20 text-indigo-400" : "text-gray-300"
                }`}
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
          >
            A-
          </button>
          <button
            onClick={() => setFontIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}
            disabled={fontIdx === FONT_SIZES.length - 1}
            className="rounded-lg px-2.5 py-1.5 text-base font-medium text-gray-300 active:bg-gray-800 disabled:opacity-30"
          >
            A+
          </button>
          <span className="mx-0.5 text-gray-800">|</span>
          <button
            onClick={() => setSpeedIdx((i) => Math.max(0, i - 1))}
            disabled={speedIdx === 0}
            className="rounded-lg px-2 py-1.5 text-base font-bold leading-none text-gray-300 active:bg-gray-800 disabled:opacity-30"
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
            No sheet content for this song.{" "}
            <Link to={`/songs/${currentSong.song_id}`} className="text-indigo-400 hover:text-indigo-300">
              Add content
            </Link>{" "}
            first.
          </p>
        )}

        {/* Next song preview */}
        {currentIdx < songs.length - 1 && (
          <div className="mt-12 border-t border-gray-800 pt-4">
            <button
              data-nav-btn
              onClick={(e) => { e.stopPropagation(); goToSong(currentIdx + 1); }}
              className="text-sm text-gray-500 hover:text-gray-300"
            >
              Up next: <span className="font-medium text-gray-400">{songs[currentIdx + 1].song_name}</span> &rsaquo;
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
