import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api, formatDate, canEdit } from "../api";
import type { Setlist } from "../api";
import FormModal from "../components/FormModal";
import GroupSelector from "../components/GroupSelector";
import ListItemCard from "../components/ListItemCard";
import { ListSkeleton } from "../components/PageLoadingSkeleton";
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
    <ListSkeleton
      toolbar={
        <div className="mb-4 flex items-center justify-between">
          <div className="h-8 w-40 animate-pulse rounded bg-gray-800" />
          <div className="flex gap-1">
            {[1, 2].map((i) => (
              <div key={i} className="h-8 w-20 animate-pulse rounded bg-gray-800" />
            ))}
          </div>
        </div>
      }
      cards={3}
      rightSide="one-line"
    />
  );

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "date", label: "Date" },
    { key: "name", label: "Name" },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <GroupSelector
          groups={user?.groups ?? []}
          value={groupFilter}
          onChange={setGroupFilter}
          allLabel="All groups"
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="min-w-0 truncate rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
        >
          {sortOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
        {canEdit(user) && (
          <div className="ml-auto shrink-0">
            <button
              onClick={() => { setCreating(true); setNewName(""); setNewDate(""); setNewGroupId(null); setErrorMsg(null); }}
              className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-500"
              title="New Setlist"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 sm:hidden">
                <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
              </svg>
              <span className="hidden sm:inline">New Setlist</span>
            </button>
          </div>
        )}
      </div>

      <FormModal
        open={creating && canEdit(user) === true}
        title="New Setlist"
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
          placeholder="Setlist name"
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
        />
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
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

      {setlists.length === 0 && !creating ? (
        <p className="text-gray-400">
          No setlists yet. Create one to start organizing songs for gigs.
        </p>
      ) : (
        <div className="space-y-3">
          {sorted.map((sl) => (
            <ListItemCard
              key={sl.id}
              to={`/setlists/${sl.id}`}
              title={<>
                {sl.name}
                {user && user.groups.length > 1 && !groupFilter && sl.group_name && (
                  <span className="ml-2 text-xs font-normal text-gray-500">{sl.group_name}</span>
                )}
              </>}
              right={<>{sl.song_count} song{sl.song_count !== 1 ? "s" : ""}</>}
            >
              <div className="mt-1 text-sm text-gray-400">
                {sl.date ? formatDate(sl.date) : "No date set"}
              </div>
            </ListItemCard>
          ))}
        </div>
      )}
    </div>
  );
}
