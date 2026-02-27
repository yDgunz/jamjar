import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, formatDate, canEdit } from "../api";
import type { Song } from "../api";
import FormModal from "../components/FormModal";
import GroupSelector from "../components/GroupSelector";
import { useAuth } from "../context/AuthContext";

type SortKey = "name" | "last_played" | "takes";

export default function SongCatalog() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>(() => {
    const stored = localStorage.getItem("song-catalog-sort");
    if (stored === "name" || stored === "last_played" || stored === "takes") return stored;
    return "name";
  });
  const [groupFilter, setGroupFilter] = useState<number | null>(() => {
    const stored = localStorage.getItem("song-catalog-group");
    if (stored) { const n = Number(stored); if (!isNaN(n)) return n; }
    return null;
  });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGroupId, setNewGroupId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem("song-catalog-sort", sortBy); }, [sortBy]);
  useEffect(() => {
    if (groupFilter !== null) localStorage.setItem("song-catalog-group", String(groupFilter));
    else localStorage.removeItem("song-catalog-group");
  }, [groupFilter]);

  useEffect(() => {
    api.listSongs().then((data) => {
      setSongs(data);
      setLoading(false);
    });
  }, []);

  const sorted = useMemo(() => {
    const filtered = groupFilter !== null
      ? songs.filter((s) => s.group_id === groupFilter)
      : songs;
    const copy = [...filtered];
    switch (sortBy) {
      case "name":
        return copy.sort((a, b) => a.name.localeCompare(b.name));
      case "last_played":
        return copy.sort((a, b) => (b.last_date ?? "").localeCompare(a.last_date ?? ""));
      case "takes":
        return copy.sort((a, b) => b.take_count - a.take_count);
    }
  }, [songs, sortBy, groupFilter]);

  const defaultGroupId = user && user.groups.length === 1 ? user.groups[0].id : null;

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const groupId = newGroupId ?? defaultGroupId;
    if (!groupId) return;
    try {
      const song = await api.createSong(name, groupId);
      navigate(`/songs/${song.id}`);
    } catch (err) {
      setErrorMsg(`Failed to create song: ${err instanceof Error ? err.message : err}`);
    }
  };

  if (loading) return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="h-8 w-40 animate-pulse rounded bg-gray-800" />
        <div className="flex gap-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded bg-gray-800" />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-5 py-4">
            <div className="space-y-2">
              <div className="h-5 w-40 animate-pulse rounded bg-gray-800" />
              <div className="h-4 w-32 animate-pulse rounded bg-gray-800" />
            </div>
            <div className="h-4 w-16 animate-pulse rounded bg-gray-800" />
          </div>
        ))}
      </div>
    </div>
  );

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "name", label: "Name" },
    { key: "last_played", label: "Last played" },
    { key: "takes", label: "Most tracks" },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">Songs</h1>
        <GroupSelector
          groups={user?.groups ?? []}
          value={groupFilter}
          onChange={setGroupFilter}
          allLabel="All groups"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
        >
          {sortOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
        {canEdit(user) && (
          <div className="ml-auto">
            <button
              onClick={() => { setCreating(true); setNewName(""); setNewGroupId(null); setErrorMsg(null); }}
              className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-500"
              title="New Song"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 sm:hidden">
                <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
              </svg>
              <span className="hidden sm:inline">New Song</span>
            </button>
          </div>
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
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          placeholder="Song name"
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
        />
        {user && user.groups.length > 1 && (
          <select
            value={newGroupId ?? defaultGroupId ?? ""}
            onChange={(e) => setNewGroupId(Number(e.target.value))}
            className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
          >
            <option value="" disabled>Group</option>
            {user.groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        )}
      </FormModal>

      {songs.length === 0 && !creating ? (
        <p className="text-gray-400">
          No songs yet. Create one or tag tracks from a{" "}
          <Link to="/" className="text-accent-400 hover:text-accent-300">recording</Link>.
        </p>
      ) : (
        <div className="space-y-3">
          {sorted.map((song) => (
            <Link
              key={song.id}
              to={`/songs/${song.id}`}
              className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 transition hover:border-accent-500 hover:bg-gray-800"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-white">
                  {song.name}
                  {user && user.groups.length > 1 && !groupFilter && song.group_name && (
                    <span className="ml-2 text-xs font-normal text-gray-500">{song.group_name}</span>
                  )}
                </div>
                {song.artist && (
                  <div className="text-sm text-gray-500">{song.artist}</div>
                )}
                <div className="mt-1 text-sm text-gray-400">
                  {song.last_date
                    ? `Last played ${formatDate(song.last_date)}`
                    : "No date info"}
                </div>
              </div>
              <div className="shrink-0 text-right text-sm text-gray-400">
                {song.take_count} track{song.take_count !== 1 ? "s" : ""}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
