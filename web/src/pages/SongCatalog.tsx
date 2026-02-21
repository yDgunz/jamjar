import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { api, formatDate, canEdit } from "../api";
import type { Song } from "../api";
import { useAuth } from "../context/AuthContext";

type SortKey = "name" | "last_played" | "takes";

export default function SongCatalog() {
  const { user } = useAuth();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [groupFilter, setGroupFilter] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGroupId, setNewGroupId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

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
      setSongs((prev) => [...prev, song]);
      setNewName("");
      setCreating(false);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(`Failed to create song: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleDelete = async (songId: number) => {
    try {
      await api.deleteSong(songId);
      setSongs((prev) => prev.filter((s) => s.id !== songId));
      setDeleting(null);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(`Failed to delete: ${err instanceof Error ? err.message : err}`);
      setDeleting(null);
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
        {user && user.groups.length > 1 && (
          <select
            value={groupFilter ?? ""}
            onChange={(e) => setGroupFilter(e.target.value ? Number(e.target.value) : null)}
            className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-base sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
          >
            <option value="">All groups</option>
            {user.groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        )}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="ml-auto rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-base sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
        >
          {sortOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
      </div>

      {errorMsg && (
        <div className="mb-3 rounded bg-red-900/50 px-3 py-2 text-sm text-red-300">
          {errorMsg}
          <button onClick={() => setErrorMsg(null)} className="ml-2 text-red-400 hover:text-red-200">&times;</button>
        </div>
      )}

      {canEdit(user) && (
        <div className="mb-3">
          {creating ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={createInputRef}
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") { setCreating(false); setNewName(""); }
                }}
                placeholder="Song name"
                className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              {user && user.groups.length > 1 && (
                <select
                  value={newGroupId ?? defaultGroupId ?? ""}
                  onChange={(e) => setNewGroupId(Number(e.target.value))}
                  className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="" disabled>Group</option>
                  {user.groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              )}
              <button
                onClick={handleCreate}
                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Add
              </button>
              <button
                onClick={() => { setCreating(false); setNewName(""); }}
                className="rounded px-3 py-1.5 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="rounded border border-dashed border-gray-700 px-3 py-1.5 text-sm text-gray-400 hover:border-indigo-500 hover:text-indigo-400"
            >
              + New song
            </button>
          )}
        </div>
      )}

      {songs.length === 0 && !creating ? (
        <p className="text-gray-400">
          No songs yet. Create one above or tag tracks from a{" "}
          <Link to="/" className="text-indigo-400 hover:text-indigo-300">recording</Link>.
        </p>
      ) : (
        <div className="space-y-3">
          {sorted.map((song) => (
            <div key={song.id} className="group relative">
              <Link
                to={`/songs/${song.id}`}
                className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 transition hover:border-indigo-500 hover:bg-gray-800"
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
              {canEdit(user) && deleting === song.id ? (
                <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-gray-800 px-2 py-1 shadow">
                  <span className="text-xs text-gray-300">Delete?</span>
                  <button
                    onClick={() => handleDelete(song.id)}
                    className="rounded px-2 py-0.5 text-xs font-medium text-red-400 hover:bg-red-900/40"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setDeleting(null)}
                    className="rounded px-2 py-0.5 text-xs text-gray-400 hover:text-white"
                  >
                    No
                  </button>
                </div>
              ) : canEdit(user) ? (
                <button
                  onClick={(e) => { e.preventDefault(); setDeleting(song.id); }}
                  className="absolute right-2 top-2 hidden rounded p-1 text-gray-600 hover:text-red-400 group-hover:block"
                  title="Delete song"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
