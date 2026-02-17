import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { api, formatDate } from "../api";
import type { Session, Track, Song } from "../api";
import AudioPlayer from "../components/AudioPlayer";
import type { Marker } from "../components/AudioPlayer";
import Modal, { Toast } from "../components/Modal";
import TrackRow from "../components/TrackRow";

function MergeButton({ trackId, nextTrackId, onTracksChanged, onError }: {
  trackId: number;
  nextTrackId: number;
  onTracksChanged: (tracks: Track[]) => void;
  onError: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleMerge = async () => {
    setConfirming(false);
    setLoading(true);
    try {
      const newTracks = await api.mergeTrack(trackId, nextTrackId);
      onTracksChanged(newTracks);
    } catch (err) {
      onError(`Merge failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-center py-0.5">
        <button
          onClick={() => setConfirming(true)}
          disabled={loading}
          className="flex items-center gap-1.5 rounded px-3 py-2 text-xs text-gray-600 transition hover:bg-gray-800 hover:text-gray-300 disabled:opacity-50"
          title="Merge with take above"
        >
          {loading ? (
            <>
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Merging...
            </>
          ) : (
            <>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M7 8l5 4-5 4M17 8l-5 4 5 4" />
              </svg>
              Merge
            </>
          )}
        </button>
      </div>
      <Modal
        open={confirming}
        title="Merge takes"
        message="Merge these two takes into one? The first take's song tag and notes will be kept."
        confirmLabel="Merge"
        onConfirm={handleMerge}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(-30);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();

  const sessionId = Number(id);
  const showError = useCallback((msg: string) => setErrorMsg(msg), []);

  useEffect(() => {
    Promise.all([
      api.getSession(sessionId),
      api.getSessionTracks(sessionId),
      api.listSongs(),
    ]).then(([s, t, allSongs]) => {
      setSession(s);
      setTracks(t);
      setSongs(allSongs);
      setNameInput(s?.name ?? "");
      setDateInput(s?.date ?? "");
      setNotesInput(s?.notes ?? "");
      setLoading(false);
    });
  }, [sessionId]);

  const refresh = () => {
    api.getSessionTracks(sessionId).then(setTracks);
    api.getSession(sessionId).then((s) => {
      setSession(s);
      setNameInput(s?.name ?? "");
      setDateInput(s?.date ?? "");
      setNotesInput(s?.notes ?? "");
    });
    api.listSongs().then(setSongs);
  };

  const handleTracksChanged = (newTracks: Track[]) => {
    setTracks(newTracks);
    api.getSession(sessionId).then((s) => {
      setSession(s);
      setNameInput(s?.name ?? "");
      setDateInput(s?.date ?? "");
      setNotesInput(s?.notes ?? "");
    });
    api.listSongs().then(setSongs);
  };

  const handleSaveName = async () => {
    await api.updateSessionName(sessionId, nameInput.trim());
    setEditingName(false);
    refresh();
  };

  const handleSaveDate = async () => {
    await api.updateSessionDate(sessionId, dateInput || null);
    setEditingDate(false);
    refresh();
  };

  const handleSaveSessionNotes = async () => {
    await api.updateSessionNotes(sessionId, notesInput.trim());
    setEditingNotes(false);
    refresh();
  };

  const handleReprocess = async (direction: "stricter" | "looser") => {
    const newThreshold = direction === "stricter" ? threshold + 3 : threshold - 3;
    setReprocessOpen(false);
    setReprocessing(true);
    try {
      const newTracks = await api.reprocessSession(sessionId, newThreshold, 120);
      setThreshold(newThreshold);
      handleTracksChanged(newTracks);
      setSuccessMsg(`Reprocessed: ${newTracks.length} take${newTracks.length !== 1 ? "s" : ""} found`);
    } catch (err) {
      showError(`Reprocess failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setReprocessing(false);
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    try {
      await api.deleteSession(sessionId, true);
      navigate("/");
    } catch (err) {
      showError(`Delete failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (!session) return <p className="text-red-400">Session not found.</p>;

  return (
    <div>
      {reprocessing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="flex flex-col items-center gap-4">
            <svg className="h-8 w-8 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-lg text-gray-200">Reprocessing...</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <Link to="/" className="text-sm text-indigo-400 hover:text-indigo-300">
          &larr; All Sessions
        </Link>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setReprocessOpen(true)}
            className="rounded px-2 py-1.5 text-xs text-gray-500 transition hover:text-gray-300"
          >
            Reprocess
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="rounded px-2 py-1.5 text-xs text-gray-500 transition hover:text-red-400"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-4 mb-6">
        {/* Editable session name */}
        {editingName ? (
          <input
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveName();
              if (e.key === "Escape") { setEditingName(false); setNameInput(session.name); }
            }}
            onBlur={handleSaveName}
            className="w-full max-w-lg rounded border border-gray-700 bg-gray-800 px-2 py-1 text-2xl font-bold text-white focus:border-indigo-500 focus:outline-none"
          />
        ) : (
          <h1
            onClick={() => setEditingName(true)}
            className="cursor-pointer text-2xl font-bold hover:text-indigo-400"
            title="Click to rename"
          >
            {session.name || session.source_file}
          </h1>
        )}

        <p className="mt-1 text-gray-400">
          {editingDate ? (
            <input
              type="date"
              autoFocus
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveDate();
                if (e.key === "Escape") { setEditingDate(false); setDateInput(session.date ?? ""); }
              }}
              onBlur={handleSaveDate}
              className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-base sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          ) : (
            <button
              onClick={() => setEditingDate(true)}
              className="hover:text-indigo-400"
              title="Click to change date"
            >
              {formatDate(session.date)}
            </button>
          )}
          {" "}&middot; {session.track_count} take{session.track_count !== 1 ? "s" : ""} &middot;{" "}
          {session.tagged_count} tagged
        </p>

        {/* Session notes */}
        <div className="mt-2">
          {editingNotes ? (
            <textarea
              autoFocus
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveSessionNotes(); }
                if (e.key === "Escape") { setEditingNotes(false); setNotesInput(session.notes ?? ""); }
              }}
              onBlur={handleSaveSessionNotes}
              placeholder="Add session notes..."
              rows={3}
              className="w-full max-w-md rounded border border-gray-700 bg-gray-800 px-2 py-1 text-base sm:text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
          ) : session.notes ? (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-left text-sm whitespace-pre-wrap text-gray-400 italic hover:text-gray-300"
            >
              {session.notes}
            </button>
          ) : (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-sm text-gray-600 hover:text-gray-400"
            >
              + add session notes
            </button>
          )}
        </div>

        {/* Full session audio */}
        <div className="mt-4 rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Full Recording</p>
          <AudioPlayer
            src={api.sessionAudioUrl(sessionId)}
            markers={tracks.flatMap((t): Marker[] => [
              { timeSec: t.start_sec, label: `Take ${t.track_number} start` },
              { timeSec: t.end_sec, label: `Take ${t.track_number} end` },
            ])}
          />
        </div>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-700" />
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Takes</span>
        <div className="h-px flex-1 bg-gray-700" />
      </div>

      <div className="space-y-0">
        {tracks.map((t, i) => (
          <div key={t.id}>
            <TrackRow
              track={t}
              songs={songs}
              onUpdate={refresh}
              onTracksChanged={handleTracksChanged}
              onError={showError}
            />
            {i < tracks.length - 1 && (
              <MergeButton
                trackId={t.id}
                nextTrackId={tracks[i + 1].id}
                onTracksChanged={handleTracksChanged}
                onError={showError}
              />
            )}
          </div>
        ))}
      </div>
      {reprocessOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setReprocessOpen(false)} />
          <div className="relative mx-4 w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 px-6 py-5 shadow-xl">
            <h3 className="text-sm font-semibold text-white">Wrong number of takes?</h3>
            <p className="mt-2 text-sm text-gray-400">
              Current takes and tags will be replaced.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setReprocessOpen(false)}
                className="rounded px-4 py-2 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => handleReprocess("looser")}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
              >
                Too few
              </button>
              <button
                onClick={() => handleReprocess("stricter")}
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
              >
                Too many
              </button>
            </div>
          </div>
        </div>
      )}
      <Modal
        open={confirmDelete}
        title="Delete session"
        message="Delete this session and all its takes? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
      {errorMsg && (
        <Toast message={errorMsg} variant="error" onClose={() => setErrorMsg(null)} />
      )}
      {successMsg && (
        <Toast message={successMsg} variant="success" onClose={() => setSuccessMsg(null)} />
      )}
    </div>
  );
}
