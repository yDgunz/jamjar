import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { api } from "../api";
import type { Session, Track, Song } from "../api";
import TrackRow from "../components/TrackRow";

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

      <div className="space-y-2">
        {tracks.map((t) => (
          <TrackRow key={t.id} track={t} songs={songs} onUpdate={refresh} />
        ))}
      </div>
    </div>
  );
}
