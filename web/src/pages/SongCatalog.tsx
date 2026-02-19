import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { api, formatDate } from "../api";
import type { Song } from "../api";
import { useAuth } from "../context/AuthContext";

type SortKey = "name" | "last_played" | "takes";

export default function SongCatalog() {
  const { user } = useAuth();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [groupFilter, setGroupFilter] = useState<number | null>(null);

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

  if (songs.length === 0) {
    return (
      <p className="text-gray-400">
        No songs tagged yet. Tag takes from a{" "}
        <Link to="/" className="text-indigo-400 hover:text-indigo-300">recording</Link> to build your catalog.
      </p>
    );
  }

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "name", label: "Name" },
    { key: "last_played", label: "Last played" },
    { key: "takes", label: "Most takes" },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-lg font-bold">Songs</h1>
        {user && user.groups.length > 1 && (
          <>
            <div className="mx-1 h-4 w-px bg-gray-700" />
            <div className="flex items-center gap-1">
              <button
                onClick={() => setGroupFilter(null)}
                className={`rounded px-2.5 py-1.5 text-xs transition ${
                  groupFilter === null
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                }`}
              >
                All
              </button>
              {user.groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGroupFilter(g.id)}
                  className={`rounded px-2.5 py-1.5 text-xs transition ${
                    groupFilter === g.id
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          {sortOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSortBy(opt.key)}
              className={`rounded px-2.5 py-1.5 text-xs transition ${
                sortBy === opt.key
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {sorted.map((song) => (
          <Link
            key={song.id}
            to={`/songs/${song.id}`}
            className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 transition hover:border-indigo-500 hover:bg-gray-800"
          >
            <div>
              <div className="font-medium text-white">
                {song.name}
                {user && user.groups.length > 1 && !groupFilter && song.group_name && (
                  <span className="ml-2 text-xs font-normal text-gray-500">{song.group_name}</span>
                )}
              </div>
              <div className="mt-1 text-sm text-gray-400">
                {song.last_date
                  ? `Last played ${formatDate(song.last_date)}`
                  : "No date info"}
              </div>
            </div>
            <div className="text-right text-sm text-gray-400">
              {song.take_count} take{song.take_count !== 1 ? "s" : ""}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
