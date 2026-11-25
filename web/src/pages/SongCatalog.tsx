import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, formatRelative, formatShortDate, canEdit, localSongActivity } from "../api";
import type { Song } from "../api";
import ArtistPicker from "../components/ArtistPicker";
import FetchError from "../components/FetchError";
import FormModal from "../components/FormModal";
import { BandChip, FilterBar, SortChip } from "../components/FilterChip";
import HasPicker from "../components/HasPicker";
import type { HasChoice, HasItem } from "../components/HasPicker";
import ListItemCard, { ListRows } from "../components/ListItemCard";
import SongHas from "../components/SongHas";
import PageHeader, { HeaderIconButton, PlusIcon } from "../components/PageHeader";
import { ListSkeleton } from "../components/PageLoadingSkeleton";
import SearchInput from "../components/SearchInput";
import { useAuth } from "../context/AuthContext";
import { useFetch } from "../hooks/useFetch";
import { NO_ARTIST, countArtists, groupByArtist, sortName } from "../utils/artists";

type SortKey = "opened" | "performed" | "recorded" | "added" | "takes" | "name";

const SORT_OPTIONS: { key: SortKey; label: string; short: string }[] = [
  { key: "opened", label: "Recently opened", short: "Opened" },
  { key: "performed", label: "Recently performed", short: "Performed" },
  { key: "recorded", label: "Recently recorded", short: "Recorded" },
  { key: "added", label: "Recently added", short: "Added" },
  { key: "takes", label: "Most recorded", short: "Most takes" },
  { key: "name", label: "Name (A–Z)", short: "A–Z" },
];

const SORT_KEYS = SORT_OPTIONS.map((o) => o.key) as string[];

type ArtistSort = "count" | "name";
const ARTISTS_PATH = "/songs?view=artists";

const HAS_ITEMS: HasItem<HasKey>[] = [
  { key: "chart", label: "Chart", yes: "Chart", no: "No chart" },
  { key: "tab", label: "Guitar tab", yes: "Tab", no: "No tab" },
  { key: "score", label: "Sheet music", yes: "Sheet music", no: "No sheet music" },
  { key: "recorded", label: "Recordings", yes: "Recorded", no: "Not recorded" },
  { key: "opened", label: "Opened or performed", yes: "Opened", no: "Never opened" },
];
type HasKey = "chart" | "tab" | "score" | "recorded" | "opened";
type HasFilter = Record<HasKey, HasChoice>;

const NO_HAS: HasFilter = { chart: "any", tab: "any", score: "any", recorded: "any", opened: "any" };

const SONG_HAS: Record<HasKey, (song: Song) => boolean> = {
  chart: (s) => Boolean(s.has_sheet),
  tab: (s) => Boolean(s.has_tab),
  score: (s) => Boolean(s.score_format),
  recorded: (s) => s.take_count > 0,
  opened: (s) => Boolean(s.last_opened_at || s.last_performed_at),
};

/** The saved Has filter; falls back to the three separate filters it replaced. */
function storedHas(): HasFilter {
  const has = { ...NO_HAS };
  try {
    const raw = localStorage.getItem("song-has-filter");
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, unknown>;
      for (const { key } of HAS_ITEMS) {
        if (saved[key] === "yes" || saved[key] === "no") has[key] = saved[key];
      }
      return has;
    }
    const old = (k: string) => localStorage.getItem(k);
    const recorded = old("song-recorded-filter");
    const activity = old("song-activity-filter");
    const content = old("song-content-filter") ?? "";
    if (recorded === "yes" || recorded === "no") has.recorded = recorded;
    if (activity === "yes" || activity === "no") has.opened = activity;
    const kind = content.replace("no-", "");
    if (kind === "chart" || kind === "tab" || kind === "score") has[kind] = content.startsWith("no-") ? "no" : "yes";
  } catch { /* storage unavailable or unreadable */ }
  return has;
}
const PAGE = 50;

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Newest of the server timestamp and the locally remembered one. */
function latest(a: string | null | undefined, b: string | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/** Sort newest first; songs without a value go last, alphabetically. */
function byRecent(a: string | null, b: string | null, an: string, bn: string): number {
  if (a && b) return b.localeCompare(a) || an.localeCompare(bn);
  if (a) return -1;
  if (b) return 1;
  return an.localeCompare(bn);
}

function matches(song: Song, q: string, lyricHits: Map<number, string>): "name" | "lyrics" | null {
  if (song.name.toLowerCase().includes(q) || (song.artist ?? "").toLowerCase().includes(q)) {
    return "name";
  }
  return lyricHits.has(song.id) ? "lyrics" : null;
}

export default function SongCatalog() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: songs, loading, error: fetchError, refresh: refreshSongs } = useFetch(
    () => api.listSongs(),
    [],
  );
  const [sortBy, setSortBy] = useState<SortKey>(() => {
    const stored = localStorage.getItem("song-catalog-sort");
    return stored && SORT_KEYS.includes(stored) ? (stored as SortKey) : "opened";
  });
  const [groupFilter, setGroupFilter] = useState<number | null>(() => {
    const stored = localStorage.getItem("group-filter");
    if (stored) { const n = Number(stored); if (!isNaN(n)) return n; }
    return null;
  });
  // /songs?view=artists lists the artists; /songs?artist=<name> is one artist's
  // songs, opened from that list (the artist in the address wins over the chip's
  // remembered one and isn't remembered itself)
  const [params] = useSearchParams();
  // An empty ?artist= stands for the songs that have no artist
  const urlArtist = params.get("artist") === "" ? NO_ARTIST : params.get("artist");
  const view: "songs" | "artists" = urlArtist === null && params.get("view") === "artists" ? "artists" : "songs";
  const [artistSort, setArtistSort] = useState<ArtistSort>(() => stored("song-artists-sort", ["count", "name"] as const, "count"));
  const [storedArtist, setStoredArtist] = useState<string>(() => localStorage.getItem("song-artist-filter") ?? "");
  const artistFilter = urlArtist ?? storedArtist;
  // What is typed belongs to the list it was typed in: it starts empty in another view
  const searchKey = urlArtist !== null ? `artist:${urlArtist}` : view;
  const [search, setSearch] = useState({ key: searchKey, text: "" });
  const query = search.key === searchKey ? search.text : "";
  const setQuery = (text: string) => setSearch({ key: searchKey, text });
  const [hasFilter, setHasFilter] = useState<HasFilter>(storedHas);
  const [shown, setShown] = useState(PAGE);
  const [lyricHits, setLyricHits] = useState<Map<number, string>>(new Map());
  const sentinel = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newArtist, setNewArtist] = useState("");
  const [newGroupId, setNewGroupId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const multiGroup = user != null && user.groups.length > 1;

  useEffect(() => { localStorage.setItem("song-catalog-sort", sortBy); }, [sortBy]);
  useEffect(() => {
    if (groupFilter !== null) localStorage.setItem("group-filter", String(groupFilter));
    else localStorage.removeItem("group-filter");
  }, [groupFilter]);

  useEffect(() => {
    try {
      localStorage.setItem("song-artist-filter", storedArtist);
      localStorage.setItem("song-has-filter", JSON.stringify(hasFilter));
      for (const k of ["song-recorded-filter", "song-activity-filter", "song-content-filter"]) localStorage.removeItem(k);
      localStorage.setItem("song-artists-sort", artistSort);
    } catch { /* storage unavailable */ }
  }, [storedArtist, hasFilter, artistSort]);

  const q = query.trim().toLowerCase();

  // Lyrics live on the server (the list leaves charts out); look them up as you type
  useEffect(() => {
    if (q.length < 2) { setLyricHits(new Map()); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      api.searchLyrics(q)
        .then((hits) => { if (!cancelled) setLyricHits(new Map(hits.map((h) => [h.id, h.line]))); })
        .catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  // Artists (with song counts) of the band being looked at
  const inBand = useMemo(
    () => (songs ?? []).filter(
      (s) => groupFilter === null || (s.groups ?? []).some((g) => g.id === groupFilter) || s.group_id === groupFilter,
    ),
    [songs, groupFilter],
  );
  const { artists, none: noArtistCount } = useMemo(() => countArtists(inBand), [inBand]);

  // The Artists view: one row per artist, narrowed by what is typed
  const artistGroups = useMemo(() => {
    if (view !== "artists") return [];
    let groups = groupByArtist(inBand);
    if (q) groups = groups.filter((g) => (g.name || "no artist").toLowerCase().includes(q));
    if (artistSort === "name") {
      groups = [...groups].sort((a, b) =>
        Number(a.name === "") - Number(b.name === "") || sortName(a.name).localeCompare(sortName(b.name)));
    }
    return groups;
  }, [view, inBand, q, artistSort]);

  const results = useMemo(() => {
    const local = localSongActivity();
    let list = (songs ?? []).map((s) => ({
      song: {
        ...s,
        last_opened_at: latest(s.last_opened_at, local[s.id]?.opened),
        last_performed_at: latest(s.last_performed_at, local[s.id]?.performed),
      },
      hit: q ? matches(s, q, lyricHits) : ("name" as const),
    }));
    if (artistFilter === NO_ARTIST) list = list.filter((r) => !r.song.artist);
    else if (artistFilter) list = list.filter((r) => r.song.artist === artistFilter);
    for (const { key } of HAS_ITEMS) {
      const want = hasFilter[key];
      if (want !== "any") list = list.filter((r) => SONG_HAS[key](r.song) === (want === "yes"));
    }
    if (groupFilter !== null) {
      list = list.filter((r) => (r.song.groups ?? []).some((g) => g.id === groupFilter) || r.song.group_id === groupFilter);
    }
    if (q) list = list.filter((r) => r.hit !== null);
    const cmp: Record<SortKey, (a: Song, b: Song) => number> = {
      opened: (a, b) => byRecent(a.last_opened_at, b.last_opened_at, a.name, b.name),
      performed: (a, b) => byRecent(a.last_performed_at, b.last_performed_at, a.name, b.name),
      recorded: (a, b) => byRecent(a.last_date, b.last_date, a.name, b.name),
      added: (a, b) => byRecent(a.created_at, b.created_at, a.name, b.name),
      takes: (a, b) => b.take_count - a.take_count || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
    };
    // When searching, title/artist matches come before lyric-only matches
    return list.sort((a, b) =>
      (q ? Number(a.hit === "lyrics") - Number(b.hit === "lyrics") : 0) || cmp[sortBy](a.song, b.song),
    );
  }, [songs, sortBy, groupFilter, q, lyricHits, artistFilter, hasFilter]);

  // Show the list a page at a time; load more as the bottom comes into view
  useEffect(() => { setShown(PAGE); }, [sortBy, groupFilter, q, artistFilter, hasFilter]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) setShown((n) => n + PAGE); },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [results.length, shown]);

  const filtersOn = Boolean(storedArtist && urlArtist === null) || HAS_ITEMS.some((i) => hasFilter[i.key] !== "any");

  const defaultGroupId = user && user.groups.length === 1 ? user.groups[0].id : null;

  const openCreate = (name = "") => {
    setCreating(true);
    setNewName(name);
    setNewArtist("");
    setNewGroupId(groupFilter);
    setErrorMsg(null);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const groupId = newGroupId ?? defaultGroupId;
    if (!groupId) return;
    try {
      const song = await api.createSong(name, groupId, newArtist.trim() || undefined);
      navigate(`/songs/${song.id}`);
    } catch (err) {
      setErrorMsg(`Failed to create song: ${err instanceof Error ? err.message : err}`);
    }
  };

  if (loading) return <ListSkeleton rightSide="one-line" cards={8} />;
  if (fetchError) return <FetchError error={fetchError} onRetry={refreshSongs} />;

  return (
    <div>
      {urlArtist !== null && (
        <Link to={ARTISTS_PATH} className="inline-flex items-center gap-0.5 text-sm text-accent-400 hover:text-accent-300">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
          </svg>
          Artists
        </Link>
      )}
      <PageHeader
        title={urlArtist !== null ? (
          urlArtist === NO_ARTIST ? "No artist" : urlArtist
        ) : (
          <span className="flex items-baseline gap-4">
            <Link to="/songs" aria-current={view === "songs" ? "page" : undefined} className={view === "songs" ? "" : "text-gray-600 hover:text-gray-400"}>
              Songs
            </Link>
            <Link to={ARTISTS_PATH} aria-current={view === "artists" ? "page" : undefined} className={view === "artists" ? "" : "text-gray-600 hover:text-gray-400"}>
              Artists
            </Link>
          </span>
        )}
        actions={canEdit(user) && (
          <HeaderIconButton label="New song" onClick={() => openCreate()}>
            <PlusIcon />
          </HeaderIconButton>
        )}
      />

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={view === "artists" ? "Search artists" : "Search songs, artists, lyrics"}
      />

      <div className="mt-3">
      {view === "artists" ? (
        <FilterBar onClear={groupFilter !== null ? () => setGroupFilter(null) : undefined}>
          <SortChip
            value={artistSort}
            options={[{ value: "count", label: "Most songs" }, { value: "name", label: "A–Z" }]}
            onChange={setArtistSort}
            ariaLabel="Sort artists"
          />
          <BandChip groups={user?.groups ?? []} value={groupFilter} onChange={setGroupFilter} />
        </FilterBar>
      ) : (
      <FilterBar
        onClear={filtersOn || groupFilter !== null
          ? () => { if (urlArtist === null) setStoredArtist(""); setHasFilter(NO_HAS); setGroupFilter(null); }
          : undefined}
      >
        <SortChip
          value={sortBy}
          options={SORT_OPTIONS.map((o) => ({ value: o.key, label: o.label, short: o.short }))}
          onChange={setSortBy}
          ariaLabel="Sort songs"
        />
        <BandChip groups={user?.groups ?? []} value={groupFilter} onChange={setGroupFilter} />
        {urlArtist === null && (
          <ArtistPicker
            value={storedArtist}
            artists={artists}
            noArtistCount={noArtistCount}
            total={inBand.length}
            onChange={setStoredArtist}
          />
        )}
        <HasPicker items={HAS_ITEMS} value={hasFilter} onChange={setHasFilter} />
      </FilterBar>
      )}
      </div>

      <FormModal
        open={creating && canEdit(user) === true}
        title="New Song"
        error={errorMsg}
        confirmLabel="Add"
        onConfirm={handleCreate}
        onCancel={() => { setCreating(false); setErrorMsg(null); }}
      >
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Song name"
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
        />
        <input
          value={newArtist}
          onChange={(e) => setNewArtist(e.target.value)}
          placeholder="Artist (optional)"
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
        />
        {multiGroup && (
          <select
            value={newGroupId ?? defaultGroupId ?? ""}
            onChange={(e) => setNewGroupId(Number(e.target.value))}
            className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
          >
            <option value="" disabled>Band</option>
            {user!.groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        )}
      </FormModal>

      {(songs ?? []).length === 0 && !q ? (
        <p className="mt-6 text-gray-400">
          No songs yet. Add one with <span className="text-white">+</span>, or tag tracks from a{" "}
          <Link to="/sessions" className="text-accent-400 hover:text-accent-300">recording</Link>.
        </p>
      ) : view === "artists" ? (
        artistGroups.length === 0 ? (
          <p className="mt-8 text-center text-gray-400">No artist matches “{query.trim()}”.</p>
        ) : (
          <div className="mt-1">
            <ListRows>
              {artistGroups.map((g) => {
                // An artist with one song opens that song; more open the artist's songs
                const only = g.songs.length === 1 ? g.songs[0] : null;
                const names = g.songs.slice(0, 4).map((s) => s.name).join(", ");
                return (
                  <ListItemCard
                    key={g.name}
                    to={only ? `/songs/${only.id}` : `/songs?${new URLSearchParams({ artist: g.name })}`}
                    state={only ? { from: { to: ARTISTS_PATH, label: "Artists" } } : undefined}
                    title={g.name || <span className="text-gray-400">No artist</span>}
                    right={<span className="tabular-nums">{g.songs.length}</span>}
                  >
                    <div className="mt-0.5 truncate text-sm text-gray-400">
                      {names}{g.songs.length > 4 ? ", …" : ""}
                    </div>
                  </ListItemCard>
                );
              })}
            </ListRows>
          </div>
        )
      ) : results.length === 0 ? (
        <div className="mt-8 text-center">
          <p className="text-gray-400">
            {q ? <>No songs match “{query.trim()}”{filtersOn ? " with these filters" : ""}.</> : "No songs match these filters."}
          </p>
          {q && canEdit(user) && (
            <button
              onClick={() => openCreate(query.trim())}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
            >
              <PlusIcon /> Add “{query.trim()}”
            </button>
          )}
        </div>
      ) : (
        <div className="mt-1">
          <ListRows>
            {results.slice(0, shown).map(({ song, hit }) => {
              const when =
                sortBy === "opened" ? (song.last_opened_at ? `opened ${formatRelative(song.last_opened_at)}` : null)
                : sortBy === "performed" ? (song.last_performed_at ? `performed ${formatRelative(song.last_performed_at)}` : null)
                : sortBy === "added" ? (song.created_at ? `added ${formatRelative(song.created_at)}` : null)
                : song.last_date ? `recorded ${formatShortDate(song.last_date)}` : null;
              const meta = [
                urlArtist === null ? song.artist : null,
                when,
                multiGroup && !groupFilter ? (song.groups?.length ? song.groups.map((g) => g.name).join(", ") : song.group_name) : null,
              ].filter(Boolean).join(" · ");
              return (
                <ListItemCard
                  key={song.id}
                  to={`/songs/${song.id}`}
                  title={song.name}
                  right={<SongHas song={song} />}
                >
                  {(meta || hit === "lyrics") && (
                    <div className="mt-0.5 truncate text-sm text-gray-400">
                      {hit === "lyrics" && q ? <span className="text-accent-400">“{lyricHits.get(song.id)}”</span> : null}
                      {hit === "lyrics" && q && meta ? " · " : null}
                      {meta}
                    </div>
                  )}
                </ListItemCard>
              );
            })}
          </ListRows>
          {shown < results.length && <div ref={sentinel} className="h-10" aria-hidden />}
        </div>
      )}
    </div>
  );
}
