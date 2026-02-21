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
        No songs tagged yet. Tag tracks from a{" "}
        <Link to="/" className="text-indigo-400 hover:text-indigo-300">recording</Link> to build your catalog.
      </p>
    );
  }

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
      <div className="space-y-3">
        {sorted.map((song) => (
          <Link
            key={song.id}
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
    </div>
  );
}
