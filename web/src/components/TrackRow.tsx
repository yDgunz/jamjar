import { useState } from "react";
import { api, canEdit, canAdmin } from "../api";
import type { Track, Song } from "../api";
import ActionSheet, { MoreButton } from "./ActionSheet";
import type { SheetAction, SheetSection } from "./ActionSheet";
import Modal from "./Modal";
import Spinner from "./Spinner";
import ShareDialog from "../share/ShareDialog";
import { useAuth } from "../context/AuthContext";
import { formatTime, usePlayer } from "../context/PlayerContext";

interface Props {
  track: Track;
  sessionName: string;
  sessionDuration: number | null;
  songs: Song[];
  onUpdate: () => void;
  onTracksChanged: (tracks: Track[]) => void;
  onError: (msg: string) => void;
  /** Present when there's a following track this one can merge with */
  onMergeNext?: () => void;
}

/** Animated "now playing" bars shown in place of the track number. */
function EqualizerIcon({ animate }: { animate: boolean }) {
  return (
    <span className="flex h-4 items-end justify-center gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-sm bg-accent-400 ${animate ? "animate-[eq_0.9s_ease-in-out_infinite]" : ""}`}
          style={{ height: animate ? undefined : `${[60, 100, 40][i]}%`, animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

export default function TrackRow({
  track, sessionName, sessionDuration, songs, onUpdate, onTracksChanged, onError, onMergeNext,
}: Props) {
  const { user } = useAuth();
  const player = usePlayer();
  const playerKey = `track:${track.id}`;
  const isCurrent = player.isCurrent(playerKey);
  const playerTime = isCurrent ? player.currentTime : 0;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [tagInput, setTagInput] = useState(track.song_name ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState(track.notes ?? "");
  const [operationLoading, setOperationLoading] = useState(false);
  const [confirmingSplit, setConfirmingSplit] = useState(false);
  const [confirmingTrim, setConfirmingTrim] = useState<"start" | "end" | null>(null);
  const [confirmingExtend, setConfirmingExtend] = useState<{ direction: "start" | "end"; seconds: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const title = track.song_name ?? `Track ${track.track_number}`;

  const playThis = () =>
    player.play({
      key: playerKey,
      src: api.trackAudioUrl(track.id),
      title,
      subtitle: sessionName,
      href: track.song_id ? `/songs/${track.song_id}` : undefined,
      durationSec: track.duration_sec,
      trackId: track.id,
    });

  const handleTag = async (name?: string) => {
    const value = (name ?? tagInput).trim();
    if (!value) return;
    await api.tagTrack(track.id, value);
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

  const runOperation = async (label: string, fn: () => Promise<void>) => {
    setOperationLoading(true);
    try {
      await fn();
    } catch (err) {
      onError(`${label} failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setOperationLoading(false);
    }
  };

  const handleTrim = () => {
    const trimType = confirmingTrim;
    setConfirmingTrim(null);
    if (isCurrent) player.close();
    return runOperation("Trim", async () => {
      if (trimType === "start") await api.trimTrack(track.id, playerTime);
      else await api.trimTrack(track.id, undefined, -(track.duration_sec - playerTime));
      onUpdate();
    });
  };

  const handleExtend = () => {
    if (!confirmingExtend) return;
    const { direction, seconds } = confirmingExtend;
    setConfirmingExtend(null);
    if (isCurrent) player.close();
    return runOperation("Extend", async () => {
      if (direction === "start") await api.trimTrack(track.id, -seconds);
      else await api.trimTrack(track.id, undefined, seconds);
      onUpdate();
    });
  };

  const handleSplit = () => {
    setConfirmingSplit(false);
    if (isCurrent) player.close();
    return runOperation("Split", async () => {
      onTracksChanged(await api.splitTrack(track.id, playerTime));
    });
  };

  // Song suggestions while tagging — max 4
  const suggestions = tagInput.trim()
    ? songs
        .filter((s) => s.name.toLowerCase().includes(tagInput.toLowerCase()) && s.name.toLowerCase() !== tagInput.toLowerCase())
        .slice(0, 4)
    : songs.slice().sort((a, b) => (b.last_date ?? "").localeCompare(a.last_date ?? "")).slice(0, 4);

  // ── Action sheet ──
  const pausedMidTrack = isCurrent && !player.playing && playerTime > 1 && playerTime < track.duration_sec - 1;
  const extendAmounts = [10, 30];
  const sections: SheetSection[] = [];

  const main: SheetAction[] = [];
  if (track.song_id) main.push({ label: "Go to song", href: `/songs/${track.song_id}` });
  if (canEdit(user)) {
    main.push({ label: track.song_name ? "Change song" : "Tag song", onClick: () => { setTagInput(track.song_name ?? ""); setTagging(true); } });
    if (track.song_name) main.push({ label: "Remove song tag", onClick: handleUntag });
    main.push({ label: track.notes ? "Edit notes" : "Add notes", onClick: () => { setNotesInput(track.notes ?? ""); setEditingNotes(true); } });
  }
  main.push({ label: "Share…", onClick: () => setShareOpen(true) });
  main.push({ label: "Download", href: `${api.trackAudioUrl(track.id)}?download=1`, download: `${title}.m4a` });
  sections.push({ actions: main });

  if (canAdmin(user)) {
    const edit: SheetAction[] = [];
    if (pausedMidTrack) {
      edit.push({ label: `Trim start to ${formatTime(playerTime)}`, onClick: () => setConfirmingTrim("start") });
      edit.push({ label: `Trim end to ${formatTime(playerTime)}`, onClick: () => setConfirmingTrim("end") });
      edit.push({ label: `Split at ${formatTime(playerTime)}`, onClick: () => setConfirmingSplit(true) });
    }
    for (const s of extendAmounts) {
      if (track.start_sec >= s) edit.push({ label: `Add ${s}s before`, onClick: () => setConfirmingExtend({ direction: "start", seconds: s }) });
    }
    for (const s of extendAmounts) {
      if (sessionDuration != null && track.end_sec + s <= sessionDuration) {
        edit.push({ label: `Add ${s}s after`, onClick: () => setConfirmingExtend({ direction: "end", seconds: s }) });
      }
    }
    if (onMergeNext) edit.push({ label: "Merge with next track", onClick: onMergeNext });
    sections.push({
      title: "Edit track",
      note: pausedMidTrack ? undefined : "To trim or split, play this track and pause at the spot.",
      actions: edit,
    });
  }


  return (
    <div className="relative">
      {operationLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-950/80">
          <div className="flex items-center gap-2 text-sm text-gray-300"><Spinner size="sm" /> Processing…</div>
        </div>
      )}

      <div className="-mx-4 flex items-center gap-1 px-4 sm:mx-0 sm:px-0">
        <button
          onClick={playThis}
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left transition active:opacity-70"
        >
          <span className="w-6 shrink-0 text-center text-sm tabular-nums text-gray-500">
            {isCurrent ? <EqualizerIcon animate={player.playing} /> : track.track_number}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[17px] leading-snug sm:text-base ${
              isCurrent ? "font-medium text-accent-400" : track.song_name ? "text-white" : "text-gray-400"
            }`}>
              {title}
            </span>
            <span className="block truncate text-sm text-gray-500">
              <span className="tabular-nums">{formatTime(track.duration_sec)}</span>
              {track.auto_tagged && track.song_name && (
                <span title="Recognised from the singing. Change or remove the tag if it's wrong."> · auto-tagged</span>
              )}
              {track.notes && <span className="italic text-gray-400"> · {track.notes}</span>}
            </span>
          </span>
        </button>
        {!track.song_name && canEdit(user) && !tagging && (
          <button
            onClick={() => { setTagInput(""); setTagging(true); }}
            className="shrink-0 rounded-full border border-accent-500/50 px-3 py-1 text-sm font-medium text-accent-400 active:bg-accent-500/10"
          >
            Tag
          </button>
        )}
        <MoreButton onClick={() => setSheetOpen(true)} label={`Actions for ${title}`} />
      </div>

      {tagging && canEdit(user) && (
        <div className="mb-3 ml-9 rounded-xl bg-white/[0.04] p-3">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTag();
                if (e.key === "Escape") { setTagging(false); setTagInput(track.song_name ?? ""); }
              }}
              placeholder="Which song is this?"
              className="w-full rounded-lg bg-white/[0.08] px-3 py-2 text-base text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent-500/60"
            />
            <button
              onClick={() => { setTagging(false); setTagInput(track.song_name ?? ""); }}
              className="shrink-0 px-2 py-2 text-sm text-gray-400"
            >
              Cancel
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleTag(s.name)}
                className="rounded-full bg-white/[0.08] px-3 py-1.5 text-sm text-gray-200 transition active:bg-accent-600"
              >
                {s.name}
              </button>
            ))}
            {tagInput.trim() && !songs.some((s) => s.name.toLowerCase() === tagInput.trim().toLowerCase()) && (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleTag()}
                className="rounded-full border border-dashed border-accent-500/60 px-3 py-1.5 text-sm text-accent-400"
              >
                + New song “{tagInput.trim()}”
              </button>
            )}
          </div>
        </div>
      )}

      {editingNotes && canEdit(user) && (
        <div className="mb-3 ml-9">
          <textarea
            autoFocus
            value={notesInput}
            onChange={(e) => setNotesInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveNotes(); }
              if (e.key === "Escape") { setEditingNotes(false); setNotesInput(track.notes ?? ""); }
            }}
            onBlur={handleSaveNotes}
            placeholder="Notes about this take…"
            rows={2}
            className="w-full rounded-lg bg-white/[0.08] px-3 py-2 text-base text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent-500/60"
          />
        </div>
      )}

      <ShareDialog open={shareOpen} kind="track" id={track.id} title={title} onClose={() => setShareOpen(false)} />

      <ActionSheet
        open={sheetOpen}
        title={title}
        subtitle={`Track ${track.track_number} · ${formatTime(track.start_sec)}–${formatTime(track.end_sec)}`}
        sections={sections}
        onClose={() => setSheetOpen(false)}
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
        message={`Split this track into two at ${formatTime(playerTime)}? The first half keeps the current song tag and notes.`}
        confirmLabel="Split"
        onConfirm={handleSplit}
        onCancel={() => setConfirmingSplit(false)}
      />
    </div>
  );
}
