import { useEffect, useState, useRef, useCallback } from "react";

export const FONT_SIZES = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl"];
export const SPEED_MULTIPLIERS = [0.5, 0.75, 1, 1.5, 2, 3, 4];
const TARGET_DURATION = 150;
const LS_FONT_KEY = "perform-font-size";
const LS_SPEED_KEY = "perform-scroll-speed";
const LS_WRAP_KEY = "perform-wrap-text";
const LS_LYRICS_ONLY_KEY = "perform-lyrics-only";

function loadInt(key: string, def: number, max: number): number {
  const stored = localStorage.getItem(key);
  if (stored !== null) {
    const val = Number(stored);
    if (val >= 0 && val <= max) return val;
  }
  return def;
}

export function usePerformMode() {
  const [fontIdx, setFontIdx] = useState(() => loadInt(LS_FONT_KEY, 4, FONT_SIZES.length - 1));
  const [transpose, setTranspose] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(() => loadInt(LS_SPEED_KEY, 2, SPEED_MULTIPLIERS.length - 1));

  const [wrapText, setWrapText] = useState(() => localStorage.getItem(LS_WRAP_KEY) !== "0");
  const [lyricsOnly, setLyricsOnly] = useState(() => localStorage.getItem(LS_LYRICS_ONLY_KEY) === "1");
  const [headerVisible, setHeaderVisible] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const offsetRef = useRef<number>(0);
  const headerTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const touchStartRef = useRef<{ y: number; time: number } | null>(null);

  // Persist settings
  useEffect(() => { localStorage.setItem(LS_FONT_KEY, String(fontIdx)); }, [fontIdx]);
  useEffect(() => { localStorage.setItem(LS_SPEED_KEY, String(speedIdx)); }, [speedIdx]);
  useEffect(() => { localStorage.setItem(LS_WRAP_KEY, wrapText ? "1" : "0"); }, [wrapText]);
  useEffect(() => { localStorage.setItem(LS_LYRICS_ONLY_KEY, lyricsOnly ? "1" : "0"); }, [lyricsOnly]);

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
      setShowSettings(false);
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

  // Reset state for navigating to a new song (used by setlist mode)
  const resetForSong = useCallback(() => {
    setScrolling(false);
    setShowSettings(false);
    setTranspose(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setHeaderVisible(true);
  }, []);

  return {
    fontIdx, setFontIdx,
    transpose, setTranspose,
    scrolling, setScrolling,
    speedIdx, setSpeedIdx,

    wrapText, setWrapText,
    lyricsOnly, setLyricsOnly,
    headerVisible, setHeaderVisible,
    showSettings, setShowSettings,
    scrollRef, contentRef,
    handleBodyTap, handleTouchStart, handleTouchEnd,
    resetForSong,
    fontClass: FONT_SIZES[fontIdx],
  };
}

export type PerformModeReturn = ReturnType<typeof usePerformMode>;
