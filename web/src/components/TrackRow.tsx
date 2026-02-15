import { useState } from "react";
import { api } from "../api";
import type { Track, Song } from "../api";
import AudioPlayer from "./AudioPlayer";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  track: Track;
  songs: Song[];
  onUpdate: () => void;
}

export default function TrackRow({ track, songs, onUpdate }: Props) {
  const [tagging, setTagging] = useState(false);
  const [tagInput, setTagInput] = useState(track.song_name ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState(track.notes ?? "");

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

  // Filter songs for autocomplete
  const suggestions = tagInput.trim()
    ? songs.filter(
        (s) =>
          s.name.toLowerCase().includes(tagInput.toLowerCase()) &&
          s.name.toLowerCase() !== tagInput.toLowerCase()
      )
    : songs;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
      {/* Header row: track name + info */}
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
          <span
            onClick={() => { setTagging(true); setTagInput(track.song_name ?? ""); }}
            className="cursor-pointer text-sm font-medium text-indigo-400 hover:text-indigo-300"
            title="Click to rename"
          >
            {track.song_name}
          </span>
        ) : (
          <button
            onClick={() => setTagging(true)}
            className="text-sm font-medium text-gray-500 hover:text-indigo-400"
          >
            Track {track.track_number}
          </button>
        )}

        {!tagging && (
          <>
            <span className="text-xs text-gray-500">
              {track.song_name ? `Track ${track.track_number} · ` : ""}{formatTime(track.start_sec)} - {formatTime(track.end_sec)}
            </span>
            <span className="text-xs text-gray-600">
              ({formatTime(track.duration_sec)})
            </span>
          </>
        )}
      </div>

      {/* Audio player */}
      <AudioPlayer src={api.trackAudioUrl(track.id)} />

      {/* Notes */}
      <div className="mt-2">
        {editingNotes ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveNotes();
                if (e.key === "Escape") { setEditingNotes(false); setNotesInput(track.notes ?? ""); }
              }}
              onBlur={handleSaveNotes}
              placeholder="Add notes..."
              className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        ) : track.notes ? (
          <button
            onClick={() => setEditingNotes(true)}
            className="text-xs text-gray-400 italic hover:text-gray-300"
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
