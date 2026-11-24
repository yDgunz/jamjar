import { useMemo, useState } from "react";
import { api } from "../api";
import type { Song } from "../api";
import { useFetch } from "../hooks/useFetch";
import FetchError from "./FetchError";
import SearchInput from "./SearchInput";

const MAX_RESULTS = 50;

interface Props {
  /** The song on screen, left out of the results */
  currentSongId: number;
  onPick: (song: Song) => void;
  onClose: () => void;
}

/**
 * Full-screen song picker for Perform mode: type a few letters, tap a song.
 * Before anything is typed it lists the songs you performed most recently.
 */
export default function SongQuickSearch({ currentSongId, onPick, onClose }: Props) {
  const { data: songs, loading, error, refresh } = useFetch(() => api.listSongs(), []);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    const others = (songs ?? []).filter((s) => s.id !== currentSongId);
    if (!q) {
      // Recently performed first, then the rest by name
      return others
        .sort((a, b) => {
          const pa = a.last_performed_at ?? "";
          const pb = b.last_performed_at ?? "";
          return pb.localeCompare(pa) || a.name.localeCompare(b.name);
        })
        .slice(0, MAX_RESULTS);
    }
    // 0 = name starts with the query, 1 = a word in the name does, 2 = elsewhere in name, 3 = artist
    const rank = (s: Song): number => {
      const name = s.name.toLowerCase();
      const at = name.indexOf(q);
      if (at === 0) return 0;
      if (at > 0) return /[\s(\-/]/.test(name[at - 1]) ? 1 : 2;
      return (s.artist ?? "").toLowerCase().includes(q) ? 3 : -1;
    };
    return others
      .map((s) => ({ s, r: rank(s) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.s.name.localeCompare(b.s.name))
      .slice(0, MAX_RESULTS)
      .map((x) => x.s);
  }, [songs, q, currentSongId]);

  return (
    <div
      role="dialog"
      aria-label="Perform another song"
      className="fixed inset-0 z-30 flex flex-col bg-gray-950 text-gray-100"
      // Keep taps away from Perform mode's tap-to-scroll zones underneath
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Escape clears the text first (SearchInput), then closes
        if (e.key === "Escape" && !query) onClose();
        if (e.key === "Enter" && q && results.length > 0) onPick(results[0]);
      }}
    >
      <div className="flex items-center gap-2 border-b border-gray-800 px-3 pt-[max(0.625rem,var(--safe-top))] pb-2.5">
        <div className="min-w-0 flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="Perform another song" autoFocus />
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg px-2 py-2 text-base text-gray-300 hover:text-white active:bg-gray-800"
        >
          Cancel
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        {error ? (
          <div className="p-4"><FetchError error={error} onRetry={refresh} /></div>
        ) : loading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-gray-800" />)}
          </div>
        ) : results.length === 0 ? (
          <p className="p-4 text-gray-500">{q ? `No songs match “${query.trim()}”.` : "No other songs yet."}</p>
        ) : (
          <ul className="mx-auto max-w-3xl">
            {results.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onPick(s)}
                  className="flex w-full items-center gap-3 border-b border-gray-900 px-4 py-3 text-left hover:bg-gray-900 active:bg-gray-800"
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-base font-medium ${s.has_sheet ? "" : "text-gray-500"}`}>
                      {s.name}
                    </span>
                    {s.artist && <span className="block truncate text-sm text-gray-500">{s.artist}</span>}
                  </span>
                  {!s.has_sheet && <span className="shrink-0 text-xs text-gray-600">no chart</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
