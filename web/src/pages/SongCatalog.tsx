import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, formatShortDate, canEdit } from "../api";
import type { Song } from "../api";
import FetchError from "../components/FetchError";
import FormModal from "../components/FormModal";
import GroupSelector from "../components/GroupSelector";
import ListItemCard, { ListRows } from "../components/ListItemCard";
import Artwork from "../components/Artwork";
import { HeaderIconButton, PlusIcon } from "../components/PageHeader";
import { ListSkeleton } from "../components/PageLoadingSkeleton";
import SearchInput from "../components/SearchInput";
import { useAuth } from "../context/AuthContext";
import { useFetch } from "../hooks/useFetch";

type SortKey = "name" | "artist" | "last_played" | "takes";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "A–Z" },
  { key: "artist", label: "Artist" },
  { key: "last_played", label: "Recently played" },
  { key: "takes", label: "Most played" },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function matches(song: Song, q: string): "name" | "lyrics" | null {
  if (song.name.toLowerCase().includes(q) || (song.artist ?? "").toLowerCase().includes(q)) {
    return "name";
  }
  if ((song.sheet ?? "").toLowerCase().includes(q)) return "lyrics";
  return null;
}

export default function SongCatalog() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: songs, loading, error: fetchError, refresh: refreshSongs } = useFetch(
    () => api.listSongs(),
    [],
  );
  const { data: sessions } = useFetch(() => api.listSessions(), []);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>(() => {
    const stored = localStorage.getItem("song-catalog-sort");
    if (stored === "name" || stored === "artist" || stored === "last_played" || stored === "takes") return stored;
    return "name";
  });
  const [groupFilter, setGroupFilter] = useState<number | null>(() => {
    const stored = localStorage.getItem("group-filter");
    if (stored) { const n = Number(stored); if (!isNaN(n)) return n; }
    return null;
  });
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

  const q = query.trim().toLowerCase();
  const recent = useMemo(
    () => [...(sessions ?? [])].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 8),
    [sessions],
  );

  const results = useMemo(() => {
    let list = (songs ?? []).map((s) => ({ song: s, hit: q ? matches(s, q) : ("name" as const) }));
    if (groupFilter !== null) list = list.filter((r) => r.song.group_id === groupFilter);
    if (q) list = list.filter((r) => r.hit !== null);
    const cmp: Record<SortKey, (a: Song, b: Song) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      artist: (a, b) => (a.artist ?? "").localeCompare(b.artist ?? "") || a.name.localeCompare(b.name),
      last_played: (a, b) => (b.last_date ?? "").localeCompare(a.last_date ?? ""),
      takes: (a, b) => b.take_count - a.take_count,
    };
    // When searching, title/artist matches come before lyric-only matches
    return list.sort((a, b) =>
      (q ? Number(a.hit === "lyrics") - Number(b.hit === "lyrics") : 0) || cmp[sortBy](a.song, b.song),
    );
  }, [songs, sortBy, groupFilter, q]);

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
      <div className="mb-5 flex items-start justify-between gap-3 pt-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-accent-400/90">{greeting()}</p>
          <h1 className="font-display mt-1 truncate text-[40px] leading-[1.05] text-white">
            {user?.name ? user.name.split(" ")[0] : "Your songs"}
          </h1>
        </div>
        {canEdit(user) && (
          <HeaderIconButton label="New song" onClick={() => openCreate()}>
            <PlusIcon />
          </HeaderIconButton>
        )}
      </div>

      <SearchInput value={query} onChange={setQuery} placeholder="Search songs, artists, lyrics" />

      {!q && recent.length > 0 && (
        <section className="mt-7">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-[26px] leading-none text-white">Recent sessions</h2>
            <Link to="/sessions" className="text-sm font-medium text-accent-400">See all</Link>
          </div>
          <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
            {recent.map((s) => {
              const names = s.song_names ? s.song_names.split(",") : [];
              return (
                <Link key={s.id} to={`/sessions/${s.id}`} className="w-36 shrink-0 snap-start active:opacity-80">
                  <Artwork seed={`session-${s.id}`} size="md" label={formatShortDate(s.date).split(" ").reverse()[0]}>
                    <div className="flex flex-col items-center leading-none text-white/95">
                      <span className="text-[11px] font-bold uppercase tracking-[0.2em]">{formatShortDate(s.date).split(" ")[0]}</span>
                      <span className="font-display mt-1 text-[56px]">{formatShortDate(s.date).split(" ")[1]?.replace(",", "")}</span>
                    </div>
                  </Artwork>
                  <div className="mt-2 truncate text-[15px] font-semibold text-white">{s.name || "Session"}</div>
                  <div className="truncate text-[13px] text-gray-400">
                    {names.length ? names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2}` : "") : `${s.track_count} tracks`}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {!q && <h2 className="font-display mt-8 text-[26px] leading-none text-white">Library</h2>}
      <div className={`${q ? "mt-3" : "mt-1"} flex items-center justify-between gap-2 text-sm text-gray-400`}>
        <span>
          {results.length} song{results.length !== 1 ? "s" : ""}
        </span>
        <div className="flex min-w-0 items-center gap-1">
          <GroupSelector
            groups={user?.groups ?? []}
            value={groupFilter}
            onChange={setGroupFilter}
            allLabel="All bands"
            variant="subtle"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            aria-label="Sort songs"
            className="min-w-0 truncate rounded bg-transparent py-1 text-right text-sm text-gray-400 focus:outline-none"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </div>
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
          <p className="text-gray-400">No songs match “{query.trim()}”.</p>
          {canEdit(user) && (
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
            {results.map(({ song, hit }) => {
              const meta = [
                song.artist,
                song.last_date ? `played ${formatShortDate(song.last_date)}` : null,
                multiGroup && !groupFilter ? song.group_name : null,
              ].filter(Boolean).join(" · ");
              return (
                <ListItemCard
                  key={song.id}
                  to={`/songs/${song.id}`}
                  title={song.name}
                  leading={<Artwork seed={`song-${song.id}`} name={song.name} size="sm" />}
                  right={song.take_count > 0 ? (
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-300">{song.take_count}</span>
                  ) : null}
                >
                  {(meta || hit === "lyrics") && (
                    <div className="mt-0.5 truncate text-sm text-gray-400">
                      {hit === "lyrics" && q ? <span className="text-accent-400">lyrics match</span> : null}
                      {hit === "lyrics" && q && meta ? " · " : null}
                      {meta}
                    </div>
                  )}
                </ListItemCard>
              );
            })}
          </ListRows>
        </div>
      )}
    </div>
  );
}
