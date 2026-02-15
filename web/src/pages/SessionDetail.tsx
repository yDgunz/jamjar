import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { api } from "../api";
import type { Session, Track, Song } from "../api";
import TrackRow from "../components/TrackRow";

function MergeButton({ trackId, nextTrackId, onTracksChanged }: {
  trackId: number;
  nextTrackId: number;
  onTracksChanged: (tracks: Track[]) => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleMerge = async () => {
    setLoading(true);
    try {
      const newTracks = await api.mergeTrack(trackId, nextTrackId);
      onTracksChanged(newTracks);
    } catch (err) {
      alert(`Merge failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center py-0.5">
      <button
        onClick={handleMerge}
        disabled={loading}
        className="flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-gray-600 transition hover:bg-gray-800 hover:text-gray-300 disabled:opacity-50"
        title="Merge with track above"
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
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState("");

  const sessionId = Number(id);

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
      setNotesInput(s?.notes ?? "");
      setLoading(false);
    });
  }, [sessionId]);

  const refresh = () => {
    api.getSessionTracks(sessionId).then(setTracks);
    api.getSession(sessionId).then((s) => {
      setSession(s);
      setNameInput(s?.name ?? "");
      setNotesInput(s?.notes ?? "");
    });
    api.listSongs().then(setSongs);
  };

  const handleTracksChanged = (newTracks: Track[]) => {
    setTracks(newTracks);
    // Also refresh session metadata (track count may have changed)
    api.getSession(sessionId).then((s) => {
      setSession(s);
      setNameInput(s?.name ?? "");
      setNotesInput(s?.notes ?? "");
    });
    api.listSongs().then(setSongs);
  };

  const handleSaveName = async () => {
    await api.updateSessionName(sessionId, nameInput.trim());
    setEditingName(false);
    refresh();
  };

  const handleSaveSessionNotes = async () => {
    await api.updateSessionNotes(sessionId, notesInput.trim());
    setEditingNotes(false);
    refresh();
  };

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (!session) return <p className="text-red-400">Session not found.</p>;

  return (
    <div>
      <Link to="/" className="text-sm text-indigo-400 hover:text-indigo-300">
        &larr; All Sessions
      </Link>

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
          {session.date ?? "Unknown date"} &middot; {session.track_count} tracks &middot;{" "}
          {session.tagged_count} tagged
        </p>
        <p className="text-xs text-gray-600">{session.source_file}</p>

        {/* Session notes */}
        <div className="mt-2">
          {editingNotes ? (
            <input
              autoFocus
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveSessionNotes();
                if (e.key === "Escape") { setEditingNotes(false); setNotesInput(session.notes ?? ""); }
              }}
              onBlur={handleSaveSessionNotes}
              placeholder="Add session notes..."
              className="w-full max-w-md rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
          ) : session.notes ? (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-sm text-gray-400 italic hover:text-gray-300"
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
      </div>

      <div className="space-y-0">
        {tracks.map((t, i) => (
          <div key={t.id}>
            <TrackRow
              track={t}
              songs={songs}
              onUpdate={refresh}
              onTracksChanged={handleTracksChanged}
            />
            {i < tracks.length - 1 && (
              <MergeButton
                trackId={t.id}
                nextTrackId={tracks[i + 1].id}
                onTracksChanged={handleTracksChanged}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
