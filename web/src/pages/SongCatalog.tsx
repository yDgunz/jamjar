import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, formatRelative, formatShortDate, canEdit, localSongActivity } from "../api";
import type { Song } from "../api";
import ArtistPicker from "../components/ArtistPicker";
import FetchError from "../components/FetchError";
import FormModal from "../components/FormModal";
import FilterChip, { BandChip, FilterBar, SortChip } from "../components/FilterChip";
import ListItemCard, { ListRows } from "../components/ListItemCard";
import SongHas from "../components/SongHas";
import PageHeader, { HeaderIconButton, PlusIcon } from "../components/PageHeader";
import { ListSkeleton } from "../components/PageLoadingSkeleton";
import SearchInput from "../components/SearchInput";
import { useAuth } from "../context/AuthContext";
import { useFetch } from "../hooks/useFetch";
import { NO_ARTIST, countArtists } from "../utils/artists";

type SortKey = "opened" | "performed" | "recorded" | "added" | "takes";

const SORT_OPTIONS: { key: SortKey; label: string; short: string }[] = [
  { key: "opened", label: "Recently opened", short: "Opened" },
  { key: "performed", label: "Recently performed", short: "Performed" },
  { key: "recorded", label: "Recently recorded", short: "Recorded" },
  { key: "added", label: "Recently added", short: "Added" },
  { key: "takes", label: "Most recorded", short: "Most takes" },
];

const SORT_KEYS = SORT_OPTIONS.map((o) => o.key) as string[];

type RecordedFilter = "any" | "yes" | "no";
type ActivityFilter = "any" | "yes" | "no";

const CONTENT_OPTIONS = [
  { value: "any", label: "Any content", short: "" },
  { value: "chart", label: "Has a chart", short: "Chart" },
  { value: "tab", label: "Has a guitar tab", short: "Tab" },
  { value: "score", label: "Has sheet music", short: "Sheet music" },
  { value: "no-chart", label: "No chart", short: "No chart" },
  { value: "no-tab", label: "No guitar tab", short: "No tab" },
  { value: "no-score", label: "No sheet music", short: "No sheet music" },
] as const;
type ContentFilter = (typeof CONTENT_OPTIONS)[number]["value"];

/** Whether a song has the chart / tab / score the content filter asks about. */
function hasContent(song: Song, f: ContentFilter): boolean {
  if (f === "any") return true;
  const kind = f.replace("no-", "");
  const has = kind === "chart" ? song.has_sheet : kind === "tab" ? song.has_tab : Boolean(song.score_format);
  return f.startsWith("no-") ? !has : Boolean(has);
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
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>(() => {
    const stored = localStorage.getItem("song-catalog-sort");
    return stored && SORT_KEYS.includes(stored) ? (stored as SortKey) : "opened";
  });
  const [groupFilter, setGroupFilter] = useState<number | null>(() => {
    const stored = localStorage.getItem("group-filter");
    if (stored) { const n = Number(stored); if (!isNaN(n)) return n; }
    return null;
  });
  const [artistFilter, setArtistFilter] = useState<string>(() => localStorage.getItem("song-artist-filter") ?? "");
  const [recordedFilter, setRecordedFilter] = useState<RecordedFilter>(() =>
    stored("song-recorded-filter", ["any", "yes", "no"] as const, "any"),
  );
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>(() =>
    stored("song-activity-filter", ["any", "yes", "no"] as const, "any"),
  );
  const [contentFilter, setContentFilter] = useState<ContentFilter>(() =>
    stored("song-content-filter", CONTENT_OPTIONS.map((o) => o.value), "any"),
  );
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
      localStorage.setItem("song-artist-filter", artistFilter);
      localStorage.setItem("song-recorded-filter", recordedFilter);
      localStorage.setItem("song-activity-filter", activityFilter);
      localStorage.setItem("song-content-filter", contentFilter);
    } catch { /* storage unavailable */ }
  }, [artistFilter, recordedFilter, activityFilter, contentFilter]);

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
    if (recordedFilter !== "any") list = list.filter((r) => (r.song.take_count > 0) === (recordedFilter === "yes"));
    if (activityFilter !== "any") {
      list = list.filter(
        (r) => Boolean(r.song.last_opened_at || r.song.last_performed_at) === (activityFilter === "yes"),
      );
    }
    if (contentFilter !== "any") list = list.filter((r) => hasContent(r.song, contentFilter));
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
    };
    // When searching, title/artist matches come before lyric-only matches
    return list.sort((a, b) =>
      (q ? Number(a.hit === "lyrics") - Number(b.hit === "lyrics") : 0) || cmp[sortBy](a.song, b.song),
    );
  }, [songs, sortBy, groupFilter, q, lyricHits, artistFilter, recordedFilter, activityFilter, contentFilter]);

  // Show the list a page at a time; load more as the bottom comes into view
  useEffect(() => { setShown(PAGE); }, [sortBy, groupFilter, q, artistFilter, recordedFilter, activityFilter, contentFilter]);
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

  const filtersOn = Boolean(artistFilter) || recordedFilter !== "any" || activityFilter !== "any" || contentFilter !== "any";

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
      <PageHeader
        title="Songs"
        actions={canEdit(user) && (
          <HeaderIconButton label="New song" onClick={() => openCreate()}>
            <PlusIcon />
          </HeaderIconButton>
        )}
      />

      <SearchInput value={query} onChange={setQuery} placeholder="Search songs, artists, lyrics" />

      <div className="mt-3">
      <FilterBar
        onClear={filtersOn || groupFilter !== null
          ? () => { setArtistFilter(""); setRecordedFilter("any"); setActivityFilter("any"); setContentFilter("any"); setGroupFilter(null); }
          : undefined}
      >
        <SortChip
          value={sortBy}
          options={SORT_OPTIONS.map((o) => ({ value: o.key, label: o.label, short: o.short }))}
          onChange={setSortBy}
          ariaLabel="Sort songs"
        />
        <BandChip groups={user?.groups ?? []} value={groupFilter} onChange={setGroupFilter} />
        <ArtistPicker
          value={artistFilter}
          artists={artists}
          noArtistCount={noArtistCount}
          total={inBand.length}
          onChange={setArtistFilter}
        />
        <FilterChip
          value={recordedFilter}
          options={[
            { value: "any", label: "Recorded or not" },
            { value: "yes", label: "Recorded" },
            { value: "no", label: "Not recorded" },
          ]}
          onChange={setRecordedFilter}
          ariaLabel="Filter by recordings"
          defaultValue="any"
          placeholder="Recorded"
        />
        <FilterChip
          value={activityFilter}
          options={[
            { value: "any", label: "Any activity" },
            { value: "yes", label: "Opened or performed" },
            { value: "no", label: "Never opened" },
          ]}
          onChange={setActivityFilter}
          ariaLabel="Filter by whether you've opened the song"
          defaultValue="any"
          placeholder="Activity"
        />
        <FilterChip
          value={contentFilter}
          options={CONTENT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          onChange={setContentFilter}
          ariaLabel="Filter by chart, tab or sheet music"
          defaultValue="any"
          placeholder="Has"
          display={(v) => CONTENT_OPTIONS.find((o) => o.value === v)?.short ?? ""}
        />
      </FilterBar>
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
                song.artist,
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
