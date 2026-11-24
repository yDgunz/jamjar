import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api, formatShortDate, canEdit } from "../api";
import FetchError from "../components/FetchError";
import FormModal from "../components/FormModal";
import { BandChip, FilterBar, SortChip } from "../components/FilterChip";
import ListItemCard, { ListRows } from "../components/ListItemCard";
import PageHeader, { HeaderIconButton, PlusIcon } from "../components/PageHeader";
import { ListSkeleton } from "../components/PageLoadingSkeleton";
import { useAuth } from "../context/AuthContext";
import { useFetch } from "../hooks/useFetch";

type SortKey = "name" | "date";

export default function SetlistList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: setlists, loading, error: fetchError, refresh: refreshSetlists } = useFetch(
    () => api.listSetlists(),
    [],
  );
  const [sortBy, setSortBy] = useState<SortKey>(() => {
    const stored = localStorage.getItem("setlist-sort");
    if (stored === "name" || stored === "date") return stored;
    return "date";
  });
  const [groupFilter, setGroupFilter] = useState<number | null>(() => {
    const stored = localStorage.getItem("group-filter");
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
    if (groupFilter !== null) localStorage.setItem("group-filter", String(groupFilter));
    else localStorage.removeItem("group-filter");
  }, [groupFilter]);

  // setlists are fetched by useFetch above

  const sorted = useMemo(() => {
    const all = setlists ?? [];
    const filtered = groupFilter !== null
      ? all.filter((s) => s.group_id === groupFilter)
      : all;
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
  if (fetchError) return <FetchError error={fetchError} onRetry={refreshSetlists} />;

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "date", label: "Date" },
    { key: "name", label: "Name" },
  ];

  return (
    <div>
      <PageHeader
        title="Setlists"
        actions={canEdit(user) && (
          <HeaderIconButton
            label="New setlist"
            onClick={() => { setCreating(true); setNewName(""); setNewDate(""); setNewGroupId(groupFilter); setErrorMsg(null); }}
          >
            <PlusIcon />
          </HeaderIconButton>
        )}
      />
      <FilterBar onClear={groupFilter !== null ? () => setGroupFilter(null) : undefined}>
        <SortChip
          value={sortBy}
          options={sortOptions.map((o) => ({ value: o.key, label: o.label }))}
          onChange={setSortBy}
          ariaLabel="Sort setlists"
        />
        <BandChip groups={user?.groups ?? []} value={groupFilter} onChange={setGroupFilter} />
      </FilterBar>

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

      {(setlists ?? []).length === 0 && !creating ? (
        <p className="text-gray-400">
          No setlists yet. Create one to start organizing songs for gigs.
        </p>
      ) : (
        <div className="mt-1">
        <ListRows>
          {sorted.map((sl) => (
            <ListItemCard
              key={sl.id}
              to={`/setlists/${sl.id}`}
              title={sl.name}
              right={<span className="text-gray-500">{sl.date ? formatShortDate(sl.date) : ""}</span>}
            >
              <div className="mt-0.5 truncate text-sm text-gray-400">
                {user && user.groups.length > 1 && !groupFilter && sl.group_name ? `${sl.group_name} · ` : ""}
                {sl.song_count} song{sl.song_count !== 1 ? "s" : ""}
              </div>
            </ListItemCard>
          ))}
        </ListRows>
        </div>
      )}
    </div>
  );
}
