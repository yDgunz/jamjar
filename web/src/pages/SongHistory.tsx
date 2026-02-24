import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { api, formatDate, canEdit, canAdmin } from "../api";
import type { Song, SongTrack } from "../api";
import AudioPlayer from "../components/AudioPlayer";
import Modal, { Toast } from "../components/Modal";
import { useAuth } from "../context/AuthContext";
import { annotateEStringRoots } from "../utils/chordUtils";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function EditableField({
  label,
  value,
  placeholder,
  mono,
  readOnly,
  rows = 3,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  mono?: boolean;
  readOnly?: boolean;
  rows?: number;
  onSave: (val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(value);

  useEffect(() => {
    setInput(value);
  }, [value]);

  const handleSave = () => {
    setEditing(false);
    if (input.trim() !== value) {
      onSave(input.trim());
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setInput(value);
  };

  return (
    <div>
      {label && (
        <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
          {label}
        </label>
      )}
      {editing && !readOnly ? (
        <div>
          <textarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) { e.preventDefault(); handleSave(); }
              if (e.key === "Escape") handleCancel();
            }}
            rows={rows}
            className={`w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-base sm:text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none ${mono ? "font-mono" : ""}`}
            placeholder={placeholder}
          />
          <div className="mt-1 flex items-center gap-2">
            <button
              onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
              className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500"
            >
              Save
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); handleCancel(); }}
              className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <span className="hidden text-xs text-gray-600 sm:inline">⌘Enter to save · Esc to cancel</span>
          </div>
        </div>
      ) : value ? (
        readOnly ? (
          mono ? (
            <div className="overflow-x-auto">
              <p className="text-sm text-gray-300 font-mono whitespace-pre">{value}</p>
            </div>
          ) : (
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{value}</p>
          )
        ) : (
          mono ? (
            <div className="overflow-x-auto">
              <button
                onClick={() => setEditing(true)}
                className="text-left text-sm text-gray-300 hover:text-white font-mono whitespace-pre"
              >
                {value}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-left text-sm text-gray-300 hover:text-white whitespace-pre-wrap"
            >
              {value}
            </button>
          )
        )
      ) : readOnly ? null : (
        <button
          onClick={() => setEditing(true)}
          className="text-sm text-gray-600 hover:text-gray-400"
        >
          + {placeholder.toLowerCase()}
        </button>
      )}
    </div>
  );
}

function TakeRow({ take, onUpdate, readOnly }: { take: SongTrack; onUpdate: () => void; readOnly?: boolean }) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState(take.notes ?? "");

  const handleSaveNotes = async () => {
    await api.updateTrackNotes(take.id, notesInput.trim());
    setEditingNotes(false);
    onUpdate();
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <Link
          to={`/sessions/${take.session_id}`}
          className="text-sm font-medium text-gray-300 hover:text-indigo-400"
        >
          {take.session_name || `Session ${take.session_id}`}
        </Link>
        <span className="text-xs text-gray-500">
          {formatDate(take.session_date)} &middot; {formatTime(take.duration_sec)}
        </span>
      </div>

      <AudioPlayer src={api.trackAudioUrl(take.id)} durationSec={take.duration_sec} />

      {/* Notes */}
      <div className="mt-2">
        {editingNotes && !readOnly ? (
          <textarea
            autoFocus
            value={notesInput}
            onChange={(e) => setNotesInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveNotes(); }
              if (e.key === "Escape") { setEditingNotes(false); setNotesInput(take.notes ?? ""); }
            }}
            onBlur={handleSaveNotes}
            placeholder="Add notes..."
            rows={2}
            className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-base sm:text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        ) : take.notes ? (
          readOnly ? (
            <p className="text-xs whitespace-pre-wrap text-gray-400 italic">{take.notes}</p>
          ) : (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-left text-xs whitespace-pre-wrap text-gray-400 italic hover:text-gray-300"
            >
              {take.notes}
            </button>
          )
        ) : readOnly ? null : (
          <button
            onClick={() => setEditingNotes(true)}
            className="text-xs text-gray-600 hover:text-gray-400"
          >
            + add notes
          </button>
        )}
      </div>
    </div>
  );
}

export default function SongHistory() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const songId = Number(id);
  const [song, setSong] = useState<Song | null>(null);
  const [takes, setTakes] = useState<SongTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [showRoots, setShowRoots] = useState(false);
  const [editingArtist, setEditingArtist] = useState(false);
  const [artistInput, setArtistInput] = useState("");
  const [fetchingLyrics, setFetchingLyrics] = useState(false);

  useEffect(() => {
    Promise.all([api.getSong(songId), api.getSongTracks(songId)]).then(
      ([songData, trackData]) => {
        setSong(songData);
        setNameInput(songData.name);
        setArtistInput(songData.artist);
        setTakes(trackData);
        setLoading(false);
      }
    );
  }, [songId]);

  const refresh = () => {
    api.getSongTracks(songId).then(setTakes);
    api.getSong(songId).then((s) => {
      setSong(s);
      setNameInput(s.name);
      setArtistInput(s.artist);
    });
  };

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === song?.name) {
      setEditingName(false);
      setNameInput(song?.name ?? "");
      return;
    }
    try {
      await api.renameSong(songId, trimmed);
      setEditingName(false);
      refresh();
    } catch (err) {
      setErrorMsg(`Rename failed: ${err instanceof Error ? err.message : err}`);
      setNameInput(song?.name ?? "");
      setEditingName(false);
    }
  };

  const handleSaveField = async (field: string, value: string) => {
    if (!song) return;
    try {
      const updated = await api.updateSongDetails(songId, {
        artist: field === "artist" ? value : song.artist,
        sheet: field === "sheet" ? value : song.sheet,
        notes: field === "notes" ? value : song.notes,
      });
      setSong(updated);
      if (field === "artist") setArtistInput(updated.artist);
    } catch (err) {
      setErrorMsg(`Save failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleSaveArtist = async () => {
    const trimmed = artistInput.trim();
    setEditingArtist(false);
    if (trimmed !== (song?.artist ?? "")) {
      await handleSaveField("artist", trimmed);
    }
  };

  const handleFetchLyrics = async () => {
    if (!song) return;
    if (song.sheet && !confirm("Append fetched lyrics to existing sheet content?")) return;
    setFetchingLyrics(true);
    try {
      const result = await api.fetchLyrics(songId);
      setSong(result.song);
    } catch (err) {
      setErrorMsg(`Fetch lyrics failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setFetchingLyrics(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deleteSong(songId);
      navigate("/songs");
    } catch (err) {
      setErrorMsg(`Delete failed: ${err instanceof Error ? err.message : err}`);
      setShowDelete(false);
    }
  };

  if (loading) return (
    <div>
      <div className="h-4 w-28 animate-pulse rounded bg-gray-800" />
      <div className="mt-4 mb-6 space-y-2">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-800" />
        <div className="h-4 w-36 animate-pulse rounded bg-gray-800" />
      </div>
      <div className="mb-6 rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-3">
        <div className="h-4 w-16 animate-pulse rounded bg-gray-800" />
        <div className="h-12 w-full animate-pulse rounded bg-gray-800" />
      </div>
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 space-y-2">
            <div className="h-4 w-40 animate-pulse rounded bg-gray-800" />
            <div className="h-10 w-full animate-pulse rounded bg-gray-800" />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <Link to="/songs" className="text-sm text-indigo-400 hover:text-indigo-300">
        &larr; Song Catalog
      </Link>

      <div className="mt-1">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {editingName && canEdit(user) ? (
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") { setEditingName(false); setNameInput(song?.name ?? ""); }
                }}
                onBlur={handleSaveName}
                className="w-full max-w-lg rounded border border-gray-700 bg-gray-800 px-2 py-1 text-lg font-bold text-white focus:border-indigo-500 focus:outline-none"
              />
            ) : (
              <h1
                onClick={() => canEdit(user) && setEditingName(true)}
                className={`text-lg font-bold ${canEdit(user) ? "cursor-pointer hover:text-indigo-400" : ""}`}
                title={canEdit(user) ? "Click to rename" : undefined}
              >
                {song?.name ?? "Unknown Song"}
                {song?.group_name && user && user.groups.length > 1 && canAdmin(user) ? (
                  <select
                    value={song.group_id}
                    onChange={async (e) => {
                      try {
                        const updated = await api.updateSongGroup(songId, Number(e.target.value));
                        setSong(updated);
                      } catch (err) {
                        setErrorMsg(`Move failed: ${err instanceof Error ? err.message : err}`);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="ml-2 rounded border border-transparent bg-transparent py-0 text-base sm:text-sm font-normal text-gray-500 hover:border-gray-700 hover:text-gray-300 focus:border-indigo-500 focus:outline-none"
                  >
                    {user!.groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                ) : song?.group_name ? (
                  <span className="ml-2 text-sm font-normal text-gray-500">{song.group_name}</span>
                ) : null}
              </h1>
            )}
            {editingArtist && canEdit(user) ? (
              <input
                autoFocus
                value={artistInput}
                onChange={(e) => setArtistInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveArtist();
                  if (e.key === "Escape") { setEditingArtist(false); setArtistInput(song?.artist ?? ""); }
                }}
                onBlur={handleSaveArtist}
                placeholder="Artist name"
                className="mt-0.5 w-full max-w-lg rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-base sm:text-sm text-gray-300 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
            ) : song?.artist ? (
              <p
                onClick={() => canEdit(user) && setEditingArtist(true)}
                className={`mt-0.5 text-sm text-gray-400 ${canEdit(user) ? "cursor-pointer hover:text-gray-300" : ""}`}
              >
                {song.artist}
              </p>
            ) : canEdit(user) ? (
              <button
                onClick={() => setEditingArtist(true)}
                className="mt-0.5 text-sm text-gray-600 hover:text-gray-400"
              >
                + add artist
              </button>
            ) : null}
            <p className="mt-0.5 text-sm text-gray-400">
              {takes.length} track{takes.length !== 1 ? "s" : ""}
              {song?.first_date && song?.last_date && (
                <span>
                  {" "}&middot;{" "}
                  {song.first_date === song.last_date
                    ? formatDate(song.first_date)
                    : `${formatDate(song.first_date)} — ${formatDate(song.last_date)}`}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {song?.sheet && (
              <Link
                to={`/songs/${songId}/perform`}
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500"
              >
                Perform
              </Link>
            )}
            {canAdmin(user) && (
              <button
                onClick={() => setShowDelete(true)}
                className="rounded px-3 py-1.5 text-xs text-gray-600 hover:bg-red-950 hover:text-red-400"
                title="Delete song"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Song metadata */}
      <div className="mb-4 space-y-4 rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Sheet</label>
            {song?.sheet && (
              <button
                onClick={() => setShowRoots((v) => !v)}
                className={`text-xs px-2 py-0.5 rounded ${showRoots ? "bg-indigo-600/20 text-indigo-400" : "text-gray-500 hover:text-gray-300"}`}
              >
                Root notes
              </button>
            )}
            {canEdit(user) && (
              <button
                onClick={handleFetchLyrics}
                disabled={!song?.artist || fetchingLyrics}
                title={!song?.artist ? "Set artist first" : "Fetch lyrics from lrclib.net"}
                className={`text-xs px-2 py-0.5 rounded ${
                  !song?.artist || fetchingLyrics
                    ? "text-gray-600 cursor-not-allowed"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {fetchingLyrics ? "Fetching..." : "Fetch lyrics"}
              </button>
            )}
          </div>
          {showRoots && song?.sheet ? (
            <div className="overflow-x-auto">
              <pre className="font-mono text-sm whitespace-pre text-gray-300">{annotateEStringRoots(song.sheet)}</pre>
            </div>
          ) : (
            <EditableField
              label=""
              value={song?.sheet ?? ""}
              placeholder="Add sheet (chords, lyrics, tabs...)"
              mono
              rows={12}
              readOnly={!canEdit(user)}
              onSave={(v) => handleSaveField("sheet", v)}
            />
          )}
        </div>
        <EditableField
          label="Notes"
          value={song?.notes ?? ""}
          placeholder="Add notes"
          readOnly={!canEdit(user)}
          onSave={(v) => handleSaveField("notes", v)}
        />
      </div>

      {takes.length === 0 ? (
        <p className="text-gray-500">No tracks found for this song.</p>
      ) : (
        <div className="space-y-2">
          {takes.map((take) => (
            <TakeRow key={take.id} take={take} onUpdate={refresh} readOnly={!canEdit(user)} />
          ))}
        </div>
      )}
      <Modal
        open={showDelete}
        title="Delete song"
        message={`Delete "${song?.name}"? ${takes.length > 0 ? `${takes.length} track${takes.length !== 1 ? "s" : ""} will be untagged.` : "This song has no tracks."}`}
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
