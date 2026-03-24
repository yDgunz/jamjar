import { useParams, Link } from "react-router";
import { api } from "../api";
import FetchError from "../components/FetchError";
import { useFetch } from "../hooks/useFetch";
import { transposeChartText } from "../utils/chordUtils";
import { isChordPro, transposeChordPro } from "../utils/chordpro";
import ChordSheet from "../components/ChordSheet";
import PerformControls from "../components/PerformControls";
import { usePerformMode } from "../hooks/usePerformMode";

export default function PerformMode() {
  const { id } = useParams<{ id: string }>();
  const songId = Number(id);
  const { data: song, loading, error: fetchError, refresh } = useFetch(
    () => api.getSong(songId),
    [songId],
  );
  const perform = usePerformMode();

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
  if (fetchError) return <div className="min-h-screen bg-gray-950 p-4"><FetchError error={fetchError} onRetry={refresh} /></div>;
  if (!song) return <div className="min-h-screen bg-gray-950 p-4 text-gray-400">Song not found.</div>;

  const hasSheet = !!song.sheet;
  const sheetText = hasSheet
    ? (isChordPro(song.sheet)
        ? transposeChordPro(song.sheet, perform.transpose)
        : transposeChartText(song.sheet, perform.transpose))
    : "";

  return (
    <div
      ref={perform.scrollRef}
      className="h-dvh overflow-y-auto bg-gray-950 text-gray-100"
      onClick={perform.handleBodyTap}
      onTouchStart={perform.handleTouchStart}
      onTouchEnd={perform.handleTouchEnd}
    >
      <div ref={perform.contentRef}>
      {/* Header — auto-hides during scroll */}
      <header
        className={`sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 px-3 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 backdrop-blur transition-all duration-300 ${
          perform.headerVisible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
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
              onClick={(e) => { e.stopPropagation(); perform.setScrolling((s) => !s); }}
              className={`shrink-0 rounded-xl px-4 py-2 text-base font-semibold transition-colors ${
                perform.scrolling
                  ? "bg-accent-600 text-white"
                  : "bg-gray-800 text-gray-200 hover:bg-gray-700 hover:text-white"
              }`}
              title={perform.scrolling ? "Pause scroll" : "Start auto-scroll"}
            >
              {perform.scrolling ? "Pause" : "Scroll"}
            </button>
          ) : (
            <div className="w-9 shrink-0" />
          )}
        </div>

        <PerformControls hasSheet={hasSheet} perform={perform} />
      </header>

      {/* Body */}
      <div className={`p-4 sm:p-6 ${perform.fontClass}`}>
        {hasSheet ? (
          <div className="mx-auto max-w-3xl">
            <ChordSheet text={sheetText} wrapText={perform.wrapText} lyricsOnly={perform.lyricsOnly} />
          </div>
        ) : (
          <p className="text-gray-500">
            No sheet content to display.{" "}
            <Link to={`/songs/${songId}`} className="text-accent-400 hover:text-accent-300">
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
