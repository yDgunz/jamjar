import { useState, useRef, useEffect } from "react";
import { Link } from "react-router";
import { api, canEdit, canAdmin } from "../api";
import type { Track, Song } from "../api";
import AudioPlayer from "./AudioPlayer";
import Modal from "./Modal";
import Spinner from "./Spinner";
import { useAuth } from "../context/AuthContext";

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  track: Track;
  trackCount: number;
  sessionDuration: number | null;
  songs: Song[];
  onUpdate: () => void;
  onTracksChanged: (tracks: Track[]) => void;
  onError: (msg: string) => void;
}

export default function TrackRow({ track, trackCount, sessionDuration, songs, onUpdate, onTracksChanged, onError }: Props) {
  const { user } = useAuth();
  const [tagging, setTagging] = useState(false);
  const [tagInput, setTagInput] = useState(track.song_name ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState(track.notes ?? "");
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerTime, setPlayerTime] = useState(0);
  const [operationLoading, setOperationLoading] = useState(false);
  const [confirmingSplit, setConfirmingSplit] = useState(false);
  const [confirmingTrim, setConfirmingTrim] = useState<"start" | "end" | null>(null);
  const [confirmingExtend, setConfirmingExtend] = useState<{ direction: "start" | "end"; seconds: number } | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shared, setShared] = useState(false);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const editMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (editMenuRef.current && !editMenuRef.current.contains(e.target as Node)) {
        setEditMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [editMenuOpen]);

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

  const handleTrim = async () => {
    const trimType = confirmingTrim;
    setConfirmingTrim(null);
    setOperationLoading(true);
    try {
      if (trimType === "start") {
        await api.trimTrack(track.id, playerTime);
      } else {
        await api.trimTrack(track.id, undefined, -(track.duration_sec - playerTime));
      }
      onUpdate();
    } catch (err) {
      onError(`Trim failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setOperationLoading(false);
    }
  };

  const handleExtend = async () => {
    if (!confirmingExtend) return;
    const { direction, seconds } = confirmingExtend;
    setConfirmingExtend(null);
    setOperationLoading(true);
    try {
      if (direction === "start") {
        await api.trimTrack(track.id, -seconds);
      } else {
        await api.trimTrack(track.id, undefined, seconds);
      }
      onUpdate();
    } catch (err) {
      onError(`Extend failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setOperationLoading(false);
    }
  };

  const canExtendStart = track.start_sec > 0;
  const canExtendEnd = sessionDuration != null && track.end_sec < sessionDuration;
  const extendAmounts = [5, 10, 30];

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

  const handleShare = async () => {
    setShareLoading(true);
    try {
      const result = await api.createShareLink(track.id);
      const fullUrl = `${window.location.origin}${result.url}`;
      if (navigator.share) {
        await navigator.share({ url: fullUrl });
      } else {
        await navigator.clipboard.writeText(fullUrl);
      }
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch (err) {
      // User cancelling the share sheet is not an error
      if (err instanceof DOMException && err.name === "AbortError") return;
      onError(`Share failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setShareLoading(false);
    }
  };

  // Filter songs for autocomplete — only show when typing, max 3
  const suggestions = tagInput.trim()
    ? songs
        .filter(
          (s) =>
            s.name.toLowerCase().includes(tagInput.toLowerCase()) &&
            s.name.toLowerCase() !== tagInput.toLowerCase()
        )
        .slice(0, 3)
    : [];

  const canSplit = !playerPlaying && playerTime > 1 && playerTime < track.duration_sec - 1;

  return (
    <div className={`relative rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 ${track.song_name ? "border-l-3 border-l-accent-500" : "border-l-2 border-l-gray-700"}`}>
      {/* Loading overlay */}
      {operationLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-gray-900/80">
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <Spinner size="sm" />
            Processing...
          </div>
        </div>
      )}

      {/* Header row: take name + info + edit buttons */}
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {tagging && canEdit(user) ? (
          <div>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleTag();
                  if (e.key === "Escape") { setTagging(false); setTagInput(track.song_name ?? ""); }
                }}
                placeholder="Search or type new song..."
                className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-base sm:text-sm font-medium text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
              />
              {track.song_name && (
                <button
                  onClick={handleUntag}
                  className="rounded py-1.5 px-2 text-xs text-gray-500 hover:text-red-400"
                >
                  Remove
                </button>
              )}
              <button
                onClick={() => { setTagging(false); setTagInput(track.song_name ?? ""); }}
                className="rounded py-1.5 px-2 text-xs text-gray-500 hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
            {/* Song chips */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    api.tagTrack(track.id, s.name).then(() => {
                      setTagging(false);
                      onUpdate();
                    });
                  }}
                  className="rounded-full bg-gray-800 px-3 py-2 text-xs text-gray-300 transition hover:bg-accent-600 hover:text-white"
                >
                  {s.name}
                  <span className="ml-1 text-gray-600">{s.take_count}</span>
                </button>
              ))}
              {tagInput.trim() && !songs.some((s) => s.name.toLowerCase() === tagInput.toLowerCase()) && (
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleTag}
                  className="rounded-full border border-dashed border-gray-600 px-3 py-2 text-xs text-accent-400 transition hover:border-accent-500 hover:bg-accent-600/20"
                >
                  + &ldquo;{tagInput.trim()}&rdquo;
                </button>
              )}
            </div>
          </div>
        ) : track.song_name ? (
          <div className="flex items-center gap-2">
            <Link
              to={`/songs/${track.song_id}`}
              className="text-sm font-medium text-accent-400 hover:text-accent-300"
            >
              {track.song_name}
            </Link>
            {canEdit(user) && (
              <button
                onClick={() => { setTagging(true); setTagInput(track.song_name ?? ""); }}
                className="rounded py-1.5 px-2 text-xs text-gray-600 hover:text-gray-300"
              >
                edit
              </button>
            )}
          </div>
        ) : canEdit(user) ? (
          <button
            onClick={() => setTagging(true)}
            className="text-sm font-medium text-gray-500 hover:text-accent-400"
          >
            Track {track.track_number}
          </button>
        ) : (
          <span className="text-sm font-medium text-gray-500">Take {track.track_number}</span>
        )}

        {!tagging && trackCount > 1 && (
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

      {/* Track edit menu — shown when paused mid-take */}
      {!playerPlaying && playerTime > 0 && canAdmin(user) && (
        <div className="relative mb-2" ref={editMenuRef}>
          <button
            onClick={() => setEditMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-400 transition hover:bg-gray-700 hover:text-white"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Edit at {formatTime(playerTime)}
          </button>
          {editMenuOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 min-w-[180px] rounded-lg border border-gray-700 bg-gray-900 py-1 shadow-xl">
              {playerTime > 1 && (
                <button
                  onClick={() => { setEditMenuOpen(false); setConfirmingTrim("start"); }}
                  disabled={operationLoading}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50"
                >
                  <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" d="M9 3v18M15 3l-6 6M15 21l-6-6" />
                  </svg>
                  Trim start to {formatTime(playerTime)}
                </button>
              )}
              {playerTime < track.duration_sec - 1 && (
                <button
                  onClick={() => { setEditMenuOpen(false); setConfirmingTrim("end"); }}
                  disabled={operationLoading}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50"
                >
                  <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" d="M15 3v18M9 3l6 6M9 21l6-6" />
                  </svg>
                  Trim end to {formatTime(playerTime)}
                </button>
              )}
              {canSplit && (
                <button
                  onClick={() => { setEditMenuOpen(false); setConfirmingSplit(true); }}
                  disabled={operationLoading}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50"
                >
                  <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" d="M12 4v16M4 12h16" />
                  </svg>
                  Split at {formatTime(playerTime)}
                </button>
              )}
              {canExtendStart && extendAmounts.filter((s) => s <= track.start_sec).map((s) => (
                <button
                  key={`ext-start-${s}`}
                  onClick={() => { setEditMenuOpen(false); setConfirmingExtend({ direction: "start", seconds: s }); }}
                  disabled={operationLoading}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50"
                >
                  <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  +{s}s before
                </button>
              ))}
              {canExtendEnd && extendAmounts.filter((s) => sessionDuration != null && track.end_sec + s <= sessionDuration).map((s) => (
                <button
                  key={`ext-end-${s}`}
                  onClick={() => { setEditMenuOpen(false); setConfirmingExtend({ direction: "end", seconds: s }); }}
                  disabled={operationLoading}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800 hover:text-white disabled:opacity-50"
                >
                  <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  +{s}s after
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Audio player */}
      <AudioPlayer
        src={api.trackAudioUrl(track.id)}
        durationSec={track.duration_sec}
        downloadUrl={`${api.trackAudioUrl(track.id)}?download=1`}
        onPlayStateChange={(playing, time) => { setPlayerPlaying(playing); setPlayerTime(time); }}
        onTimeUpdate={(time) => setPlayerTime(time)}
        onShare={handleShare}
        shareState={shareLoading ? "loading" : shared ? "copied" : "idle"}
      />
      <Modal
        open={confirmingTrim !== null}
        title={confirmingTrim === "start" ? "Trim start" : "Trim end"}
        message={
          confirmingTrim === "start"
            ? `Remove the first ${formatTime(playerTime)} from this track?`
            : `Remove the last ${formatTime(track.duration_sec - playerTime)} from this track?`
        }
        confirmLabel="Trim"
        onConfirm={handleTrim}
        onCancel={() => setConfirmingTrim(null)}
      />
      <Modal
        open={confirmingExtend !== null}
        title={confirmingExtend?.direction === "start" ? "Extend start" : "Extend end"}
        message={
          confirmingExtend?.direction === "start"
            ? `Add ${confirmingExtend.seconds}s from the full recording before this track?`
            : `Add ${confirmingExtend?.seconds}s from the full recording after this track?`
        }
        confirmLabel="Extend"
        onConfirm={handleExtend}
        onCancel={() => setConfirmingExtend(null)}
      />
      <Modal
        open={confirmingSplit}
        title="Split track"
        message={`Split this track into two at ${formatTime(playerTime)}? The first half will keep the current song tag and notes.`}
        confirmLabel="Split"
        onConfirm={handleSplit}
        onCancel={() => setConfirmingSplit(false)}
      />

      {/* Notes */}
      <div className="mt-2">
        {editingNotes && canEdit(user) ? (
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
            className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-base sm:text-xs text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
          />
        ) : track.notes ? (
          canEdit(user) ? (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-left text-xs whitespace-pre-wrap text-gray-400 italic hover:text-gray-300"
            >
              {track.notes}
            </button>
          ) : (
            <p className="text-xs whitespace-pre-wrap text-gray-400 italic">{track.notes}</p>
          )
        ) : canEdit(user) ? (
          <button
            onClick={() => setEditingNotes(true)}
            className="text-xs text-gray-600 hover:text-gray-400"
          >
            + add notes
          </button>
        ) : null}
      </div>
    </div>
  );
}
