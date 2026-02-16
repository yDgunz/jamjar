import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import type { Track, Song } from "../api";
import AudioPlayer from "./AudioPlayer";
import Modal from "./Modal";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  track: Track;
  songs: Song[];
  onUpdate: () => void;
  onTracksChanged: (tracks: Track[]) => void;
  onError: (msg: string) => void;
}

export default function TrackRow({ track, songs, onUpdate, onTracksChanged, onError }: Props) {
  const [tagging, setTagging] = useState(false);
  const [tagInput, setTagInput] = useState(track.song_name ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState(track.notes ?? "");
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerTime, setPlayerTime] = useState(0);
  const [operationLoading, setOperationLoading] = useState(false);
  const [confirmingSplit, setConfirmingSplit] = useState(false);

  const handleTag = async () => {
    if (!tagInput.trim()) return;
    await api.tagTrack(track.id, tagInput.trim());
    setTagging(false);
    onUpdate();
  };

  const handleUntag = async () => {
    await api.untagTrack(track.id);
    setTagInput("");
    onUpdate();
  };

  const handleSaveNotes = async () => {
    await api.updateTrackNotes(track.id, notesInput.trim());
    setEditingNotes(false);
    onUpdate();
  };

  const handleSplit = async () => {
    setConfirmingSplit(false);
    setOperationLoading(true);
    try {
      const newTracks = await api.splitTrack(track.id, playerTime);
      onTracksChanged(newTracks);
    } catch (err) {
      onError(`Split failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setOperationLoading(false);
    }
  };

  // Filter songs for autocomplete
  const suggestions = tagInput.trim()
    ? songs.filter(
        (s) =>
          s.name.toLowerCase().includes(tagInput.toLowerCase()) &&
          s.name.toLowerCase() !== tagInput.toLowerCase()
      )
    : songs;

  const canSplit = !playerPlaying && playerTime > 1 && playerTime < track.duration_sec - 1;

  return (
    <div className="relative rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
      {/* Loading overlay */}
      {operationLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-gray-900/80">
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Processing...
          </div>
        </div>
      )}

      {/* Header row: take name + info */}
      <div className="mb-2 flex items-center gap-2">
        {tagging ? (
          <div className="relative">
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleTag();
                  if (e.key === "Escape") { setTagging(false); setTagInput(track.song_name ?? ""); }
                }}
                onBlur={() => { if (!tagInput.trim() && !track.song_name) setTagging(false); }}
                placeholder="Song name..."
                className="w-48 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-sm font-medium text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <button
                onClick={handleTag}
                className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500"
              >
                Save
              </button>
              {track.song_name && (
                <button
                  onClick={handleUntag}
                  className="text-xs text-gray-500 hover:text-red-400"
                >
                  Remove
                </button>
              )}
              <button
                onClick={() => { setTagging(false); setTagInput(track.song_name ?? ""); }}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
            {/* Autocomplete dropdown */}
            {suggestions.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-40 w-48 overflow-y-auto rounded border border-gray-700 bg-gray-800 shadow-lg">
                {suggestions.slice(0, 8).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setTagInput(s.name);
                      api.tagTrack(track.id, s.name).then(() => {
                        setTagging(false);
                        onUpdate();
                      });
                    }}
                    className="block w-full px-2 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                  >
                    {s.name}
                    <span className="ml-2 text-xs text-gray-500">
                      {s.take_count} take{s.take_count !== 1 ? "s" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : track.song_name ? (
          <div className="flex items-center gap-2">
            <Link
              to={`/songs/${track.song_id}`}
              className="text-sm font-medium text-indigo-400 hover:text-indigo-300"
            >
              {track.song_name}
            </Link>
            <button
              onClick={() => { setTagging(true); setTagInput(track.song_name ?? ""); }}
              className="text-xs text-gray-600 hover:text-gray-300"
            >
              edit
            </button>
          </div>
        ) : (
          <button
            onClick={() => setTagging(true)}
            className="text-sm font-medium text-gray-500 hover:text-indigo-400"
          >
            Take {track.track_number}
          </button>
        )}

        {!tagging && (
          <>
            <span className="text-xs text-gray-500">
              {track.song_name ? `Take ${track.track_number} · ` : ""}{formatTime(track.start_sec)} - {formatTime(track.end_sec)}
            </span>
            <span className="text-xs text-gray-600">
              ({formatTime(track.duration_sec)})
            </span>
          </>
        )}
      </div>

      {/* Audio player */}
      <AudioPlayer
        src={api.trackAudioUrl(track.id)}
        onPlayStateChange={(playing, time) => { setPlayerPlaying(playing); setPlayerTime(time); }}
        onTimeUpdate={(time) => setPlayerTime(time)}
      />

      {/* Split button — shown when paused mid-take */}
      {canSplit && (
        <div className="mt-2">
          <button
            onClick={() => setConfirmingSplit(true)}
            disabled={operationLoading}
            className="flex items-center gap-1.5 rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-400 transition hover:bg-gray-700 hover:text-white disabled:opacity-50"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M12 4v16M4 12h16" />
            </svg>
            Split here ({formatTime(playerTime)})
          </button>
        </div>
      )}
      <Modal
        open={confirmingSplit}
        title="Split take"
        message={`Split this take into two at ${formatTime(playerTime)}? The first half will keep the current song tag and notes.`}
        confirmLabel="Split"
        onConfirm={handleSplit}
        onCancel={() => setConfirmingSplit(false)}
      />

      {/* Notes */}
      <div className="mt-2">
        {editingNotes ? (
          <textarea
            autoFocus
            value={notesInput}
            onChange={(e) => setNotesInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveNotes(); }
              if (e.key === "Escape") { setEditingNotes(false); setNotesInput(track.notes ?? ""); }
            }}
            onBlur={handleSaveNotes}
            placeholder="Add notes..."
            rows={2}
            className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          />
        ) : track.notes ? (
          <button
            onClick={() => setEditingNotes(true)}
            className="text-left text-xs whitespace-pre-wrap text-gray-400 italic hover:text-gray-300"
          >
            {track.notes}
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
