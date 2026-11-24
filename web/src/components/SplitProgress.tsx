import { useEffect, useMemo, useState } from "react";
import type { Job } from "../api";

const BARS = 96;

const STEP_LABEL: Record<string, string> = {
  download: "Fetch recording",
  analyze: "Read audio",
  upload: "Store recording",
  detect: "Find songs",
  export: "Cut tracks",
  save: "Save tracks",
  merge: "Join recordings",
};

// One colour per song, cycling; the classes are spelled out so Tailwind keeps them
const SONG_COLORS = [
  "bg-emerald-400",
  "bg-sky-400",
  "bg-amber-400",
  "bg-pink-400",
  "bg-violet-400",
  "bg-teal-300",
  "bg-orange-400",
];

/** Stand-in waveform until the real loudness profile arrives: same shape every time. */
function placeholderLevels(): number[] {
  return Array.from({ length: BARS }, (_, i) => {
    const v = 0.55 + 0.25 * Math.sin(i * 0.31) + 0.15 * Math.sin(i * 1.7 + 1) + 0.1 * Math.sin(i * 0.07);
    return Math.min(1, Math.max(0.15, v));
  });
}

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rest = String(s % 60).padStart(2, "0");
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/** Seconds since the job's work started, ticking locally between polls. */
function useElapsed(job: Job | null): number {
  const jobId = job?.id;
  const reported = job?.elapsed_sec;
  const [start, setStart] = useState<{ id: string | undefined; at: number; exact: boolean }>(() => ({
    id: jobId,
    at: Date.now(),
    exact: false,
  }));
  const [now, setNow] = useState(() => Date.now());

  // Anchor to the server's figure the first time it reports one for this job
  useEffect(() => {
    setStart((prev) => {
      if (prev.id !== jobId) {
        return { id: jobId, at: Date.now() - (reported ?? 0) * 1000, exact: reported != null };
      }
      if (!prev.exact && reported != null) {
        return { id: jobId, at: Date.now() - reported * 1000, exact: true };
      }
      return prev;
    });
  }, [jobId, reported]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (now - start.at) / 1000;
}

interface Props {
  job: Job | null;
  /** Shown when the job has no progress text yet */
  fallbackText?: string;
}

/**
 * The recording page while a recording is being split: the recording's waveform,
 * which breaks into one coloured block per song as each track is cut, plus what
 * step the job is on and how long it has been running.
 */
export default function SplitProgress({ job, fallbackText = "Processing…" }: Props) {
  const elapsed = useElapsed(job);
  const placeholder = useMemo(placeholderLevels, []);

  const levels = job?.levels && job.levels.length > 1 ? job.levels : placeholder;
  const segments = job?.segments ?? [];
  const duration = job?.duration_sec || (segments.length ? segments[segments.length - 1][1] : 0);
  const sliced = segments.length > 0 && duration > 0;
  const step = job?.step ?? null;
  const current = job?.current ?? 0;

  // Which song each bar belongs to (-1 = the gap between songs)
  const barSong = useMemo(() => {
    if (!sliced) return null;
    return levels.map((_, i) => {
      const t = ((i + 0.5) / levels.length) * duration;
      return segments.findIndex(([a, b]) => t >= a && t <= b);
    });
  }, [sliced, levels, segments, duration]);

  const songState = (n: number): "waiting" | "cutting" | "cut" | "saved" => {
    if (step === "save") return n < current ? "saved" : "cut";
    if (step === "export") return n < current ? "cut" : n === current ? "cutting" : "waiting";
    return "waiting";
  };

  const steps = job?.steps ?? [];
  const stepIndex = step ? steps.indexOf(step) : -1;
  const text = (job?.progress || fallbackText).replace(/\.\.\.$/, "…");
  const counted = (step === "export" || step === "save") && job?.total;

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-1 py-10" role="status" aria-live="polite">
      <div className="flex h-24 w-full items-center gap-px" aria-hidden="true">
        {levels.map((level, i) => {
          const song = barSong ? barSong[i] : -2;
          let cls = "split-bar-scan bg-accent-400";
          let height = Math.max(8, level * 100);
          if (barSong) {
            if (song < 0) {
              cls = "bg-gray-700";
              height = 6;
            } else {
              const state = songState(song);
              const color = SONG_COLORS[song % SONG_COLORS.length];
              cls =
                state === "saved" ? color
                : state === "cut" ? `${color} opacity-60`
                : state === "cutting" ? `${color} split-bar-cutting`
                : "bg-gray-500 opacity-40";
            }
          }
          return (
            <span
              key={i}
              className={`split-bar min-w-0 flex-1 rounded-full ${cls}`}
              style={{ height: `${height}%`, animationDelay: `${i * 28}ms` }}
            />
          );
        })}
      </div>

      <p className="mt-6 text-center text-[15px] text-gray-200">{text}</p>
      <p className="mt-1 text-center text-sm tabular-nums text-gray-500">
        Running for {formatElapsed(elapsed)}
        {counted ? ` · ${Math.min(current, job.total!)} of ${job.total} tracks ${step === "save" ? "saved" : "cut"}` : ""}
      </p>

      {steps.length > 1 && (
        <ol className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs">
          {steps.map((s, i) => {
            const done = stepIndex > i;
            const active = stepIndex === i;
            return (
              <li
                key={s}
                aria-current={active ? "step" : undefined}
                className={`flex items-center gap-1.5 ${
                  active ? "text-accent-400" : done ? "text-gray-400" : "text-gray-600"
                }`}
              >
                {done ? (
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2.5 6.5l2.5 2.5 4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span
                    className={`h-1.5 w-1.5 rounded-full bg-current ${active ? "animate-pulse" : ""}`}
                  />
                )}
                {STEP_LABEL[s] ?? s}
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-5 text-center text-xs text-gray-600">
        You can leave this page; it keeps going and the tracks will be here when you come back.
      </p>
    </div>
  );
}
