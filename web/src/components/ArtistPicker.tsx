import { useEffect, useMemo, useState } from "react";
import { NO_ARTIST, sortName } from "../utils/artists";
import type { ArtistCount } from "../utils/artists";
import { ChipButton } from "./FilterChip";
import SearchInput from "./SearchInput";

type Order = "count" | "name";

/**
 * The Artist chip of the Songs filter bar. Opens a panel (full screen on
 * phones, a centered box on larger screens) with a type-to-filter field and
 * the artists by song count or A–Z, instead of a native picker that gets
 * unusable with hundreds of artists.
 */
export default function ArtistPicker({
  value,
  artists,
  noArtistCount,
  total,
  onChange,
}: {
  /** "" = all artists, NO_ARTIST = songs without one, else the artist's name. */
  value: string;
  artists: ArtistCount[];
  noArtistCount: number;
  /** Number of songs behind "All artists". */
  total: number;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = value !== "";
  return (
    <>
      <ChipButton
        label={value === NO_ARTIST ? "No artist" : value || "Artist"}
        active={active}
        onClick={() => setOpen(true)}
        ariaLabel="Filter by artist"
      />
      {open && (
        <Panel
          value={value}
          artists={artists}
          noArtistCount={noArtistCount}
          total={total}
          onPick={(v) => { onChange(v); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Panel({
  value,
  artists,
  noArtistCount,
  total,
  onPick,
  onClose,
}: {
  value: string;
  artists: ArtistCount[];
  noArtistCount: number;
  total: number;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order>(() => {
    try {
      return localStorage.getItem("artist-picker-order") === "name" ? "name" : "count";
    } catch {
      return "count";
    }
  });
  // Typing on a phone brings up the keyboard over the list, so only focus the
  // field straight away where there is a real keyboard
  const [autoFocus] = useState(() => window.matchMedia("(hover: hover) and (pointer: fine)").matches);

  useEffect(() => {
    try { localStorage.setItem("artist-picker-order", order); } catch { /* storage unavailable */ }
  }, [order]);

  // The page behind must not scroll while the panel is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (q) {
      // Names starting with what was typed (ignoring "The") come first
      return artists
        .filter((a) => a.name.toLowerCase().includes(q))
        .map((a) => ({ a, starts: sortName(a.name).startsWith(q) || a.name.toLowerCase().startsWith(q) }))
        .sort((x, y) => Number(y.starts) - Number(x.starts) || y.a.count - x.a.count || sortName(x.a.name).localeCompare(sortName(y.a.name)))
        .map((x) => x.a);
    }
    if (order === "name") return [...artists].sort((a, b) => sortName(a.name).localeCompare(sortName(b.name)));
    return artists;
  }, [artists, q, order]);

  const row = (key: string, label: string, count: number, v: string, muted = false) => {
    const selected = value === v;
    return (
      <li key={key}>
        <button
          type="button"
          onClick={() => onPick(v)}
          aria-pressed={selected}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left text-base transition active:bg-white/5 sm:py-2 sm:text-sm sm:hover:bg-white/5 ${
            selected ? "text-accent-300" : muted ? "text-gray-400" : "text-gray-100"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {selected && (
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L4.3 10.7a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
            </svg>
          )}
          <span className="shrink-0 tabular-nums text-sm text-gray-500">{count}</span>
        </button>
      </li>
    );
  };

  const orderButton = (o: Order, label: string) => (
    <button
      type="button"
      onClick={() => setOrder(o)}
      aria-pressed={order === o}
      className={`rounded-full px-2.5 py-1 text-xs transition ${
        order === o ? "bg-white/10 text-white" : "text-gray-400 hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center"
      onKeyDown={(e) => {
        // Escape clears the text first (SearchInput), then closes
        if (e.key === "Escape" && !query) onClose();
        if (e.key === "Enter" && q && rows.length > 0) onPick(rows[0].name);
      }}
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Filter by artist"
        className="relative flex w-full flex-col bg-gray-900 shadow-2xl sm:h-[min(34rem,80vh)] sm:max-w-sm sm:rounded-2xl"
      >
        <div className="flex items-center gap-2 px-3 pt-[max(0.625rem,var(--safe-top))] pb-2 sm:pt-3">
          <div className="min-w-0 flex-1">
            <SearchInput value={query} onChange={setQuery} placeholder="Find an artist" autoFocus={autoFocus} />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-2 text-base text-gray-300 hover:text-white active:bg-gray-800 sm:text-sm"
          >
            Cancel
          </button>
        </div>
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 pb-2 text-xs text-gray-500">
          <span>
            {q
              ? `${rows.length} of ${artists.length} artists`
              : `${artists.length} ${artists.length === 1 ? "artist" : "artists"}`}
          </span>
          {!q && (
            <span className="flex items-center gap-1">
              {orderButton("count", "Most songs")}
              {orderButton("name", "A–Z")}
            </span>
          )}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] sm:pb-2">
          {!q && row("all", "All artists", total, "")}
          {rows.map((a) => row(`a:${a.name}`, a.name, a.count, a.name))}
          {!q && noArtistCount > 0 && row("none", "No artist", noArtistCount, NO_ARTIST, true)}
          {q && rows.length === 0 && (
            <li className="px-4 py-3 text-sm text-gray-500">No artist matches “{query.trim()}”.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
