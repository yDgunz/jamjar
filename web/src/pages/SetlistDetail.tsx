import { useEffect, useState, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, formatDate, canEdit, canAdmin } from "../api";
import type { Setlist, SetlistSong, Song } from "../api";
import EditableField from "../components/EditableField";
import Modal, { Toast } from "../components/Modal";
import { DetailSkeleton } from "../components/PageLoadingSkeleton";
import { useAuth } from "../context/AuthContext";

function SortableRow({
  item,
  onRemove,
  readOnly,
}: {
  item: SetlistSong;
  onRemove: () => void;
  readOnly?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.song_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3`}
    >
      {!readOnly && (
        <div
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-gray-500 active:cursor-grabbing"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </div>
      )}
      <span className="w-6 text-center text-sm font-medium text-gray-500">
        {item.position}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          to={`/songs/${item.song_id}`}
          className="text-sm font-medium text-gray-200 hover:text-accent-400"
        >
          {item.song_name}
        </Link>
        {item.artist && (
          <span className="ml-2 text-xs text-gray-500">{item.artist}</span>
        )}
      </div>
      {!readOnly && (
        <button
          onClick={onRemove}
          className="rounded p-2 text-gray-600 hover:bg-red-950 hover:text-red-400"
          title="Remove from setlist"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default function SetlistDetail() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const setlistId = Number(id);
  const [setlist, setSetlist] = useState<Setlist | null>(null);
  const [songs, setSongs] = useState<SetlistSong[]>([]);
  const [allSongs, setAllSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [addSongId, setAddSongId] = useState<number | "">("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    Promise.all([
      api.getSetlist(setlistId),
      api.getSetlistSongs(setlistId),
      api.listSongs(),
    ]).then(([sl, slSongs, allS]) => {
      setSetlist(sl);
      setNameInput(sl.name);
      setDateInput(sl.date ?? "");
      setSongs(slSongs);
      setAllSongs(allS);
      setLoading(false);
    });
  }, [setlistId]);

  const refresh = async () => {
    const [sl, slSongs] = await Promise.all([
      api.getSetlist(setlistId),
      api.getSetlistSongs(setlistId),
    ]);
    setSetlist(sl);
    setNameInput(sl.name);
    setDateInput(sl.date ?? "");
    setSongs(slSongs);
  };

  // Songs available to add (in same group, not already in setlist)
  const availableSongs = useMemo(() => {
    if (!setlist) return [];
    const inSetlist = new Set(songs.map((s) => s.song_id));
    let filtered = allSongs
      .filter((s) => s.group_id === setlist.group_id && !inSetlist.has(s.id));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) => s.name.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q),
      );
    }
    return filtered;
  }, [allSongs, songs, setlist, searchQuery]);

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === setlist?.name) {
      setEditingName(false);
      setNameInput(setlist?.name ?? "");
      return;
    }
    try {
      await api.updateSetlistName(setlistId, trimmed);
      setEditingName(false);
      refresh();
    } catch (err) {
      setErrorMsg(`Rename failed: ${err instanceof Error ? err.message : err}`);
      setNameInput(setlist?.name ?? "");
      setEditingName(false);
    }
  };

  const handleSaveDate = async () => {
    setEditingDate(false);
    const newDate = dateInput || null;
    if (newDate !== (setlist?.date ?? null)) {
      try {
        await api.updateSetlistDate(setlistId, newDate);
        refresh();
      } catch (err) {
        setErrorMsg(`Failed to update date: ${err instanceof Error ? err.message : err}`);
      }
    }
  };

  const handleSaveNotes = async (value: string) => {
    if (value !== (setlist?.notes ?? "")) {
      try {
        await api.updateSetlistNotes(setlistId, value);
        refresh();
      } catch (err) {
        setErrorMsg(`Failed to save notes: ${err instanceof Error ? err.message : err}`);
      }
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = songs.findIndex((s) => s.song_id === active.id);
    const newIndex = songs.findIndex((s) => s.song_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Optimistic reorder
    const reordered = [...songs];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    const updated = reordered.map((s, i) => ({ ...s, position: i + 1 }));
    setSongs(updated);

    try {
      await api.setSetlistSongs(setlistId, updated.map((s) => s.song_id));
    } catch (err) {
      setErrorMsg(`Reorder failed: ${err instanceof Error ? err.message : err}`);
      refresh();
    }
  };

  const handleAddSong = async () => {
    if (!addSongId) return;
    try {
      const updated = await api.addSetlistSong(setlistId, Number(addSongId));
      setSongs(updated);
      setAddSongId("");
      setSearchQuery("");
      const sl = await api.getSetlist(setlistId);
      setSetlist(sl);
    } catch (err) {
      setErrorMsg(`Failed to add song: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleRemoveSong = async (position: number) => {
    try {
      await api.removeSetlistSong(setlistId, position);
      refresh();
    } catch (err) {
      setErrorMsg(`Failed to remove song: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deleteSetlist(setlistId);
      navigate("/setlists");
    } catch (err) {
      setErrorMsg(`Delete failed: ${err instanceof Error ? err.message : err}`);
      setShowDelete(false);
    }
  };

  if (loading) return <DetailSkeleton />;

  const hasSheets = songs.some((s) => s.sheet);

  return (
    <div>
      <div>
        <div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {editingName && canEdit(user) ? (
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") { setEditingName(false); setNameInput(setlist?.name ?? ""); }
                  }}
                  onBlur={handleSaveName}
                  className="w-full max-w-lg rounded border border-gray-700 bg-gray-800 px-2 py-1 text-lg font-bold text-white focus:border-accent-500 focus:outline-none"
                />
              ) : (
                <h1
                  onClick={() => canEdit(user) && setEditingName(true)}
                  className={`text-lg font-bold ${canEdit(user) ? "cursor-pointer hover:text-accent-400" : ""}`}
                  title={canEdit(user) ? "Click to rename" : undefined}
                >
                  {setlist?.name ?? "Unknown Setlist"}
                  {setlist?.group_name && user && user.groups.length > 1 && (
                    <span className="ml-2 text-sm font-normal text-gray-500">{setlist.group_name}</span>
                  )}
                </h1>
              )}
              {editingDate && canEdit(user) ? (
                <input
                  autoFocus
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveDate();
                    if (e.key === "Escape") { setEditingDate(false); setDateInput(setlist?.date ?? ""); }
                  }}
                  onBlur={handleSaveDate}
                  className="mt-0.5 rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-base sm:text-sm text-gray-300 focus:border-accent-500 focus:outline-none"
                />
              ) : setlist?.date ? (
                <p
                  onClick={() => canEdit(user) && setEditingDate(true)}
                  className={`mt-0.5 text-sm text-gray-400 ${canEdit(user) ? "cursor-pointer hover:text-gray-300" : ""}`}
                >
                  {formatDate(setlist.date)}
                </p>
              ) : canEdit(user) ? (
                <button
                  onClick={() => setEditingDate(true)}
                  className="mt-0.5 text-sm text-gray-600 hover:text-gray-400"
                >
                  + add date
                </button>
              ) : null}
              <p className="mt-0.5 text-sm text-gray-400">
                {songs.length} song{songs.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="hidden items-center gap-1 sm:flex">
              {hasSheets && songs.length > 0 && (
                <Link
                  to={`/setlists/${setlistId}/perform`}
                  className="rounded bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500"
                >
                  Perform
                </Link>
              )}
              {canAdmin(user) && (
                <button
                  onClick={() => setShowDelete(true)}
                  className="rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-red-950 hover:text-red-400"
                  title="Delete setlist"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
          {/* Action buttons on mobile — below title */}
          <div className="mt-2 flex items-center gap-2 sm:hidden">
            {hasSheets && songs.length > 0 && (
              <Link
                to={`/setlists/${setlistId}/perform`}
                className="rounded bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500"
              >
                Perform
              </Link>
            )}
            {canAdmin(user) && (
              <button
                onClick={() => setShowDelete(true)}
                className="rounded px-3 py-2 text-xs text-gray-500 hover:bg-red-950 hover:text-red-400"
                title="Delete setlist"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="mt-3 mb-4">
        <EditableField
          label=""
          value={setlist?.notes ?? ""}
          placeholder="Add notes"
          readOnly={!canEdit(user)}
          onSave={handleSaveNotes}
        />
      </div>

      {/* Song list with drag-and-drop */}
      {songs.length === 0 ? (
        <p className="text-gray-500 mb-4">No songs in this setlist yet.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={songs.map((s) => s.song_id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2 mb-4">
              {songs.map((item) => (
                <SortableRow
                  key={item.song_id}
                  item={item}
                  readOnly={!canEdit(user)}
                  onRemove={() => handleRemoveSong(item.position)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add song */}
      {canEdit(user) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setAddSongId("");
                setDropdownOpen(true);
              }}
              onFocus={() => setDropdownOpen(true)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
              placeholder="Add a song..."
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
            />
            {dropdownOpen && !addSongId && availableSongs.length > 0 && (
              <div className="absolute left-0 right-0 z-10 bottom-full mb-1 max-h-48 overflow-y-auto rounded border border-gray-700 bg-gray-800 shadow-lg">
                {availableSongs.map((s) => (
                  <button
                    key={s.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setAddSongId(s.id);
                      setSearchQuery(s.name);
                      setDropdownOpen(false);
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-700"
                  >
                    {s.name}
                    {s.artist && <span className="ml-2 text-xs text-gray-500">{s.artist}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleAddSong}
            disabled={!addSongId}
            className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      )}

      <Modal
        open={showDelete}
        title="Delete setlist"
        message={`Delete "${setlist?.name}"? This won't delete the songs themselves.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
      />
      {errorMsg && (
        <Toast message={errorMsg} variant="error" onClose={() => setErrorMsg(null)} />
      )}
    </div>
  );
}
