import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, formatDate, canEdit } from "../api";
import type { Setlist } from "../api";
import { useAuth } from "../context/AuthContext";

type SortKey = "name" | "date";

export default function SetlistList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [setlists, setSetlists] = useState<Setlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>(() => {
    const stored = localStorage.getItem("setlist-sort");
    if (stored === "name" || stored === "date") return stored;
    return "date";
  });
  const [groupFilter, setGroupFilter] = useState<number | null>(() => {
    const stored = localStorage.getItem("setlist-group");
    if (stored) { const n = Number(stored); if (!isNaN(n)) return n; }
    return null;
  });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newGroupId, setNewGroupId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem("setlist-sort", sortBy); }, [sortBy]);
  useEffect(() => {
    if (groupFilter !== null) localStorage.setItem("setlist-group", String(groupFilter));
    else localStorage.removeItem("setlist-group");
  }, [groupFilter]);

  useEffect(() => {
    api.listSetlists().then((data) => {
      setSetlists(data);
      setLoading(false);
    });
  }, []);

  const sorted = useMemo(() => {
    const filtered = groupFilter !== null
      ? setlists.filter((s) => s.group_id === groupFilter)
      : setlists;
    const copy = [...filtered];
    switch (sortBy) {
      case "name":
        return copy.sort((a, b) => a.name.localeCompare(b.name));
      case "date":
        return copy.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    }
  }, [setlists, sortBy, groupFilter]);

  const defaultGroupId = user && user.groups.length === 1 ? user.groups[0].id : null;

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const groupId = newGroupId ?? defaultGroupId;
    if (!groupId) return;
    try {
      const setlist = await api.createSetlist(name, groupId, newDate || undefined);
      navigate(`/setlists/${setlist.id}`);
    } catch (err) {
      setErrorMsg(`Failed to create setlist: ${err instanceof Error ? err.message : err}`);
    }
  };

  if (loading) return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="h-8 w-40 animate-pulse rounded bg-gray-800" />
        <div className="flex gap-1">
          {[1, 2].map((i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded bg-gray-800" />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
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
    { key: "date", label: "Date" },
    { key: "name", label: "Name" },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">Setlists</h1>
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
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-base sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
        >
          {sortOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
        {canEdit(user) && (
          <div className="ml-auto flex items-center gap-2">
            {errorMsg && (
              <span className="text-sm text-red-400">{errorMsg}</span>
            )}
            <button
              onClick={() => setCreating(true)}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              New Setlist
            </button>
          </div>
        )}
      </div>

      {creating && canEdit(user) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") { setCreating(false); setNewName(""); setNewDate(""); }
            }}
            placeholder="Setlist name"
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
          />
          {user && user.groups.length > 1 && (
            <select
              value={newGroupId ?? defaultGroupId ?? ""}
              onChange={(e) => setNewGroupId(Number(e.target.value))}
              className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-base sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
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
            onClick={() => { setCreating(false); setNewName(""); setNewDate(""); }}
            className="rounded px-3 py-1.5 text-sm text-gray-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      )}

      {setlists.length === 0 && !creating ? (
        <p className="text-gray-400">
          No setlists yet. Create one to start organizing songs for gigs.
        </p>
      ) : (
        <div className="space-y-3">
          {sorted.map((sl) => (
            <Link
              key={sl.id}
              to={`/setlists/${sl.id}`}
              className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 transition hover:border-indigo-500 hover:bg-gray-800"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-white">
                  {sl.name}
                  {user && user.groups.length > 1 && !groupFilter && sl.group_name && (
                    <span className="ml-2 text-xs font-normal text-gray-500">{sl.group_name}</span>
                  )}
                </div>
                <div className="mt-1 text-sm text-gray-400">
                  {sl.date ? formatDate(sl.date) : "No date set"}
                </div>
              </div>
              <div className="shrink-0 text-right text-sm text-gray-400">
                {sl.song_count} song{sl.song_count !== 1 ? "s" : ""}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
