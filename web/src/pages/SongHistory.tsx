import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { api } from "../api";
import type { Song, SongTrack } from "../api";
import AudioPlayer from "../components/AudioPlayer";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function TakeRow({ take, onUpdate }: { take: SongTrack; onUpdate: () => void }) {
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
        <span className="text-sm font-medium text-gray-300">
          {take.session_date ?? "Unknown date"}
        </span>
        <span className="text-xs text-gray-500">
          {formatTime(take.duration_sec)}
        </span>
        <Link
          to={`/sessions/${take.session_id}`}
          className="text-xs text-gray-500 hover:text-indigo-400"
        >
          {take.source_file} &middot; Track {take.track_number}
        </Link>
      </div>

      <AudioPlayer src={api.trackAudioUrl(take.id)} />

      {/* Notes */}
      <div className="mt-2">
        {editingNotes ? (
          <input
            autoFocus
            value={notesInput}
            onChange={(e) => setNotesInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveNotes();
              if (e.key === "Escape") { setEditingNotes(false); setNotesInput(take.notes ?? ""); }
            }}
            onBlur={handleSaveNotes}
            placeholder="Add notes..."
            className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        ) : take.notes ? (
          <button
            onClick={() => setEditingNotes(true)}
            className="text-xs text-gray-400 italic hover:text-gray-300"
          >
            {take.notes}
          </button>
        ) : (
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
  const { id } = useParams<{ id: string }>();
  const songId = Number(id);
  const [songs, setSongs] = useState<Song[]>([]);
  const [takes, setTakes] = useState<SongTrack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.listSongs(), api.getSongTracks(songId)]).then(
      ([allSongs, trackData]) => {
        setSongs(allSongs);
        setTakes(trackData);
        setLoading(false);
      }
    );
  }, [songId]);

  const refresh = () => {
    api.getSongTracks(songId).then(setTakes);
  };

  const song = songs.find((s) => s.id === songId);

  if (loading) return <p className="text-gray-400">Loading...</p>;

  return (
    <div>
      <Link to="/songs" className="text-sm text-indigo-400 hover:text-indigo-300">
        &larr; Song Catalog
      </Link>

      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold">{song?.name ?? "Unknown Song"}</h1>
        <p className="mt-1 text-gray-400">
          {takes.length} take{takes.length !== 1 ? "s" : ""}
          {song?.first_date && song?.last_date && (
            <span>
              {" "}&middot;{" "}
              {song.first_date === song.last_date
                ? song.first_date
                : `${song.first_date} — ${song.last_date}`}
            </span>
          )}
        </p>
      </div>

      {takes.length === 0 ? (
        <p className="text-gray-500">No takes found for this song.</p>
      ) : (
        <div className="space-y-2">
          {takes.map((take) => (
            <TakeRow key={take.id} take={take} onUpdate={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
