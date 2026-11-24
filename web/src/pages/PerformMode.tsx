import { useEffect, useState } from "react";
import { useParams, Link, useLocation, useNavigate } from "react-router";
import { api, recordSongActivity } from "../api";
import FetchError from "../components/FetchError";
import { useFetch } from "../hooks/useFetch";
import { transposeChartText } from "../utils/chordUtils";
import { isChordPro, transposeChordPro } from "../utils/chordpro";
import ChordSheet from "../components/ChordSheet";
import NotebookSheet, { NotebookPage } from "../components/NotebookSheet";
import PerformControls from "../components/PerformControls";
import SongQuickSearch from "../components/SongQuickSearch";
import { usePerformMode } from "../hooks/usePerformMode";

export default function PerformMode() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Leaving Perform mode pops it off history, so Back afterwards doesn't land here again
  // (after switching songs through the search, history's previous entry belongs to the
  // first song, so the link goes to this song's page in place of Perform mode instead)
  const exit = (e: React.MouseEvent) => {
    if (location.key !== "default" && !switched) { e.preventDefault(); navigate(-1); }
  };
  const location = useLocation();
  const switched = !!(location.state as { switched?: boolean } | null)?.switched;
  const [searching, setSearching] = useState(false);
  const songId = Number(id);
  const { data: song, loading, error: fetchError, refresh } = useFetch(
    () => api.getSong(songId),
    [songId],
  );
  const perform = usePerformMode();
  useEffect(() => { recordSongActivity(songId, "performed"); }, [songId]);

  const openSearch = (e: React.MouseEvent) => {
    e.stopPropagation();
    perform.setScrolling(false);
    perform.setShowSettings(false);
    setSearching(true);
  };
  // Perform another song in place of this one (no extra history entry)
  const switchSong = (otherId: number) => {
    setSearching(false);
    perform.resetForSong();
    navigate(`/songs/${otherId}/perform`, {
      replace: true,
      state: { ...(location.state as object | null), switched: true },
    });
  };

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
      <div ref={perform.contentRef} className="flex min-h-full flex-col">
      {/* Header — auto-hides during scroll */}
      <header
        className={`sticky top-0 z-10 border-b border-gray-800 bg-gray-950/95 px-3 pt-[max(0.625rem,var(--safe-top))] pb-2.5 backdrop-blur transition-all duration-300 ${
          perform.headerVisible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
        }`}
      >
        {/* Title row */}
        <div className="flex items-center gap-2">
          <Link
            to={`/songs/${songId}`}
            onClick={exit}
            replace={switched}
            state={location.state}
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
          <button
            onClick={openSearch}
            className="shrink-0 rounded-xl p-2.5 text-gray-300 hover:text-white active:bg-gray-800"
            title="Perform another song"
            aria-label="Perform another song"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <PerformControls hasSheet={hasSheet} perform={perform} />
      </header>

      {/* Body */}
      {perform.notebook ? (
        <NotebookPage title={song.name} subtitle={song.artist} fontClass={perform.fontClass}>
          {hasSheet ? (
            <NotebookSheet text={sheetText} wrapText={perform.wrapText} lyricsOnly={perform.lyricsOnly} />
          ) : (
            <p className="opacity-60">
              No sheet content to display.{" "}
              <Link to={`/songs/${songId}`} className="underline">
                Add content
              </Link>{" "}
              first.
            </p>
          )}
        </NotebookPage>
      ) : (
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
      )}
      </div>

      {searching && (
        <SongQuickSearch
          currentSongId={songId}
          onPick={(s) => switchSong(s.id)}
          onClose={() => setSearching(false)}
        />
      )}
    </div>
  );
}
