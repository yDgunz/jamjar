import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router";
import { api } from "../api";
import type { Setlist, SetlistSong } from "../api";
import { transposeChartText } from "../utils/chordUtils";
import { isChordPro, transposeChordPro } from "../utils/chordpro";
import ChordSheet from "../components/ChordSheet";
import PerformControls from "../components/PerformControls";
import { usePerformMode } from "../hooks/usePerformMode";

export default function SetlistPerformMode() {
  const { id } = useParams<{ id: string }>();
  const setlistId = Number(id);
  const [setlist, setSetlist] = useState<Setlist | null>(null);
  const [songs, setSongs] = useState<SetlistSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const perform = usePerformMode();

  useEffect(() => {
    Promise.all([api.getSetlist(setlistId), api.getSetlistSongs(setlistId)]).then(
      ([sl, slSongs]) => {
        setSetlist(sl);
        setSongs(slSongs);
        setLoading(false);
      },
    );
  }, [setlistId]);

  // Navigate to song — reset scroll and transpose
  const goToSong = useCallback((idx: number) => {
    if (idx < 0 || idx >= songs.length) return;
    perform.resetForSong();
    setCurrentIdx(idx);
  }, [songs.length, perform.resetForSong]);

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
      <Link to={`/setlists/${setlistId}`} className="text-accent-400">Go back</Link>
    </div>
  );

  const currentSong = songs[currentIdx];
  const hasSheet = !!currentSong?.sheet;
  const sheetText = hasSheet
    ? (isChordPro(currentSong.sheet)
        ? transposeChordPro(currentSong.sheet, perform.transpose)
        : transposeChartText(currentSong.sheet, perform.transpose))
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
      {/* Header */}
      <header
        className={`sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 px-3 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 backdrop-blur transition-all duration-300 ${
          perform.headerVisible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
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
              onClick={(e) => { e.stopPropagation(); perform.setScrolling((s) => !s); }}
              className={`shrink-0 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
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
            <ChordSheet text={sheetText} wrapText={perform.wrapText} />
          </div>
        ) : (
          <p className="text-gray-500">
            No sheet content for this song.{" "}
            <Link to={`/songs/${currentSong.song_id}`} className="text-accent-400 hover:text-accent-300">
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
