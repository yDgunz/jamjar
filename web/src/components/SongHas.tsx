import type { ReactNode } from "react";
import type { Song } from "../api";

const icon = "h-[18px] w-[18px]";
const stroke = { fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 1.6 } as const;

/**
 * What a song has, as a row of small icons: chart, tab, score, recordings.
 * On wider screens each kind keeps its own column (the ones a song lacks are
 * drawn faint) so the icons line up down a list; on phones only the ones it
 * has are shown, leaving the room to the title.
 */
export default function SongHas({ song }: { song: Song }) {
  const takes = song.take_count;
  const slots: { key: string; label: string | null; node: ReactNode }[] = [
    {
      key: "chart",
      label: song.has_sheet ? "Chart" : null,
      node: (
        <svg className={icon} {...stroke}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
      ),
    },
    {
      key: "tab",
      label: song.has_tab ? "Guitar tab" : null,
      node: (
        // Tab staff: strings with fretted notes on them
        <svg className={icon} {...stroke}>
          <path strokeLinecap="round" d="M3 6h18M3 10h18M3 14h18M3 18h18" />
          <circle cx="8" cy="10" r="2.1" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="14" r="2.1" fill="currentColor" stroke="none" />
        </svg>
      ),
    },
    {
      key: "score",
      label: song.score_format ? "Sheet music" : null,
      node: (
        <svg className={icon} {...stroke}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z" />
        </svg>
      ),
    },
    {
      key: "takes",
      label: takes > 0 ? `${takes} recording${takes !== 1 ? "s" : ""}` : null,
      node: (
        <span className="flex items-center gap-0.5">
          <svg className={icon} {...stroke}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
          </svg>
          <span className={`text-left text-xs tabular-nums sm:min-w-[1.25rem] ${takes > 0 ? "" : "invisible"}`}>
            {takes}
          </span>
        </span>
      ),
    },
  ];
  return (
    <div className="flex items-center gap-2 sm:gap-2.5">
      {slots.map((s) =>
        s.label ? (
          <span key={s.key} role="img" aria-label={s.label} title={s.label} className="text-gray-300">
            {s.node}
          </span>
        ) : (
          <span key={s.key} aria-hidden className="hidden text-white/10 sm:inline">
            {s.node}
          </span>
        ),
      )}
    </div>
  );
}
