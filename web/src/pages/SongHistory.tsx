import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { api, formatDate } from "../api";
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
        <Link
          to={`/sessions/${take.session_id}`}
          className="text-sm font-medium text-gray-300 hover:text-indigo-400"
        >
          {take.session_name || take.source_file}
        </Link>
        <span className="text-xs text-gray-500">
          {formatDate(take.session_date)} &middot; {formatTime(take.duration_sec)}
        </span>
      </div>

      <AudioPlayer src={api.trackAudioUrl(take.id)} />

      {/* Notes */}
      <div className="mt-2">
        {editingNotes ? (
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
            className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        ) : take.notes ? (
          <button
            onClick={() => setEditingNotes(true)}
            className="text-left text-xs whitespace-pre-wrap text-gray-400 italic hover:text-gray-300"
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
                ? formatDate(song.first_date)
                : `${formatDate(song.first_date)} — ${formatDate(song.last_date)}`}
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
