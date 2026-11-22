import { useState } from "react";
import type { PlayerItem } from "../context/PlayerContext";
import { formatTime, PauseIcon, PlayIcon, usePlayer } from "../context/PlayerContext";

export interface ManualSegment {
  start: number;
  end: number;
}

/**
 * Split a recording by hand: play the full recording, tap "Song starts here"
 * and "Song ends here" at the right moments, then create the tracks.
 */
export default function ManualSplitPanel({
  fullItem,
  duration,
  submitting,
  onSubmit,
  onCancel,
}: {
  fullItem: PlayerItem;
  duration: number;
  submitting: boolean;
  onSubmit: (segments: ManualSegment[]) => void;
  onCancel: () => void;
}) {
  const player = usePlayer();
  const [segments, setSegments] = useState<ManualSegment[]>([]);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const isCurrent = player.isCurrent(fullItem.key);
  const now = isCurrent ? player.currentTime : 0;

  const ensurePlaying = () => {
    if (!isCurrent) player.play(fullItem);
    else player.toggle();
  };

  const seek = (sec: number) => {
    if (!isCurrent) player.play(fullItem);
    // Give the audio element a moment to load before seeking
    setTimeout(() => player.seek(sec), isCurrent ? 0 : 300);
  };

  const markStart = () => setPendingStart(now);
  const markEnd = () => {
    if (pendingStart === null || now - pendingStart < 5) return;
    setSegments((s) => [...s, { start: pendingStart, end: now }].sort((a, b) => a.start - b.start));
    setPendingStart(null);
  };

  const overlaps = segments.some((s, i) => i > 0 && s.start < segments[i - 1].end);
  const btn = "rounded-full px-4 py-2 text-sm font-semibold transition disabled:opacity-40";

  return (
    <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-white">Split by hand</h3>
          <p className="mt-0.5 text-sm text-gray-400">
            Play the recording and mark where each song starts and ends. Use the player bar below to jump around.
          </p>
        </div>
        <button onClick={onCancel} className="shrink-0 text-sm text-gray-400 hover:text-gray-200">Cancel</button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button onClick={ensurePlaying} className={`${btn} flex items-center gap-1.5 bg-white/[0.08] text-white hover:bg-white/[0.12]`}>
          {isCurrent && player.playing ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
          <span className="tabular-nums">{formatTime(now)} / {formatTime(duration)}</span>
        </button>
        {pendingStart === null ? (
          <button onClick={markStart} disabled={!isCurrent} className={`${btn} bg-accent-600 text-white hover:bg-accent-500`}>
            Song starts here
          </button>
        ) : (
          <>
            <button
              onClick={markEnd}
              disabled={!isCurrent || now - pendingStart < 5}
              className={`${btn} bg-accent-600 text-white hover:bg-accent-500`}
            >
              Song ends here
            </button>
            <span className="text-sm text-gray-400">
              started at <span className="tabular-nums">{formatTime(pendingStart)}</span>
              <button onClick={() => setPendingStart(null)} className="ml-2 text-gray-500 hover:text-gray-300">undo</button>
            </span>
          </>
        )}
      </div>

      {segments.length > 0 && (
        <ol className="mt-4 divide-y divide-white/[0.07]">
          {segments.map((s, i) => (
            <li key={`${s.start}-${s.end}`} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-6 text-gray-500">{i + 1}</span>
              <button onClick={() => seek(s.start)} className="flex-1 text-left tabular-nums text-gray-200 hover:text-white">
                {formatTime(s.start)} – {formatTime(s.end)}
                <span className="ml-2 text-gray-500">({formatTime(s.end - s.start)})</span>
              </button>
              <button
                onClick={() => setSegments((all) => all.filter((_, j) => j !== i))}
                aria-label={`Remove song ${i + 1}`}
                className="text-gray-500 hover:text-red-400"
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      {overlaps && <p className="mt-2 text-sm text-red-400">Some songs overlap — remove one to continue.</p>}

      <div className="mt-4 flex justify-end">
        <button
          onClick={() => onSubmit(segments)}
          disabled={segments.length === 0 || overlaps || submitting}
          className={`${btn} bg-accent-600 text-white hover:bg-accent-500`}
        >
          {submitting ? "Creating…" : `Create ${segments.length || ""} track${segments.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
