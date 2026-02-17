import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { api } from "../api";
import type { Song } from "../api";

const FONT_SIZES = ["text-base", "text-lg", "text-xl", "text-2xl", "text-3xl"];
const LS_KEY = "perform-font-size";

function loadFontSize(): number {
  const stored = localStorage.getItem(LS_KEY);
  if (stored !== null) {
    const idx = Number(stored);
    if (idx >= 0 && idx < FONT_SIZES.length) return idx;
  }
  return 2; // default: text-xl
}

export default function PerformMode() {
  const { id } = useParams<{ id: string }>();
  const songId = Number(id);
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoading] = useState(true);
  const [fontIdx, setFontIdx] = useState(loadFontSize);

  useEffect(() => {
    api.getSong(songId).then((s) => {
      setSong(s);
      setLoading(false);
    });
  }, [songId]);

  useEffect(() => {
    localStorage.setItem(LS_KEY, String(fontIdx));
  }, [fontIdx]);

  // Screen wake lock
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    try {
      navigator.wakeLock.request("screen").then((wl) => {
        wakeLock = wl;
      });
    } catch {
      // Wake Lock API not supported
    }
    return () => {
      wakeLock?.release();
    };
  }, []);

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

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-800 bg-gray-950/95 px-4 py-3 backdrop-blur">
        <Link
          to={`/songs/${songId}`}
          className="shrink-0 text-gray-400 hover:text-white"
          title="Back to song"
        >
          &larr;
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-center text-lg font-bold">
          {song.name}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setFontIdx((i) => Math.max(0, i - 1))}
            disabled={fontIdx === 0}
            className="rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-30"
            title="Decrease font size"
          >
            A-
          </button>
          <button
            onClick={() => setFontIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}
            disabled={fontIdx === FONT_SIZES.length - 1}
            className="rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-30"
            title="Increase font size"
          >
            A+
          </button>
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
              {song.chart}
            </pre>
          </div>
        )}
        {hasLyrics && (
          <div className={bothPresent ? "" : "mx-auto max-w-3xl"}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              Lyrics
            </h2>
            <div className="whitespace-pre-wrap leading-relaxed text-gray-200">
              {song.lyrics}
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
