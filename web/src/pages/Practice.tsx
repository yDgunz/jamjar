import { useCallback, useEffect, useRef, useState } from "react";
import ToolsHeader from "../components/ToolsHeader";
import { useMetronome, MIN_BPM, MAX_BPM } from "../hooks/useMetronome";
import { CATEGORIES, randomTask } from "../utils/practiceTasks";
import type { Category, PracticeTask } from "../utils/practiceTasks";

const DURATION = 5 * 60;
const LS_CATEGORY = "practice-category";

function loadCategory(): Category | null {
  try {
    const v = localStorage.getItem(LS_CATEGORY);
    return v && (CATEGORIES as string[]).includes(v) ? (v as Category) : null;
  } catch {
    return null;
  }
}

/** A short two-tone chime (and a buzz on phones) when the five minutes are up. */
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.25;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {
    /* audio unavailable */
  }
  navigator.vibrate?.([200, 100, 200]);
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** A random five-minute guitar practice task, with a timer and a click track. */
export default function Practice() {
  const [category, setCategory] = useState<Category | null>(loadCategory);
  const [task, setTask] = useState<PracticeTask>(() => randomTask(loadCategory() ?? undefined));
  const [remaining, setRemaining] = useState(DURATION);
  const [running, setRunning] = useState(false);
  const metro = useMetronome();
  const metroRef = useRef(metro);
  metroRef.current = metro;

  const applyTask = useCallback((t: PracticeTask) => {
    metroRef.current.stop();
    if (t.bpm) metroRef.current.setBpm(t.bpm);
    metroRef.current.setBeatsPerMeasure(t.beats ?? 4);
    setTask(t);
    setRemaining(DURATION);
    setRunning(false);
  }, []);

  useEffect(() => applyTask(task), []); // eslint-disable-line react-hooks/exhaustive-deps

  const next = (cat: Category | null = category) => applyTask(randomTask(cat ?? undefined));

  const chooseCategory = (cat: Category | null) => {
    setCategory(cat);
    try {
      if (cat) localStorage.setItem(LS_CATEGORY, cat);
      else localStorage.removeItem(LS_CATEGORY);
    } catch {
      /* storage unavailable */
    }
    next(cat);
  };

  // Countdown
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          setRunning(false);
          metroRef.current.stop();
          chime();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  // Stop the click when leaving the page
  useEffect(() => () => metroRef.current.stop(), []);

  const toggleTimer = () => {
    if (remaining === 0) {
      setRemaining(DURATION);
      setRunning(true);
    } else {
      setRunning(!running);
    }
  };

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1 text-sm transition-colors ${
      active
        ? "border-accent-500/50 bg-accent-500/15 text-accent-300"
        : "border-white/10 bg-white/[0.04] text-gray-300 hover:bg-white/[0.08]"
    }`;

  return (
    <div className="flex min-h-dvh flex-col bg-gray-950 text-gray-100">
      <ToolsHeader active="Practice" />

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4">
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <button onClick={() => chooseCategory(null)} className={chip(category === null)}>
            Anything
          </button>
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => chooseCategory(c)} className={chip(category === c)}>
              {c}
            </button>
          ))}
        </div>

        <article key={task.id} className="mt-5 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-accent-400">{task.category}</div>
          <h1 className="mt-1 text-[26px] font-bold leading-tight text-white">{task.title}</h1>
          <p className="mt-1.5 text-[15px] text-gray-400">{task.summary}</p>
          <ol className="mt-5 space-y-3">
            {task.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-[16px] leading-snug text-gray-200">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-xs font-semibold text-gray-400">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </article>

        {/* Controls stay pinned at the bottom while the steps scroll */}
        <div className="sticky bottom-0 -mx-4 mt-6 space-y-3 bg-gray-950/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="flex items-stretch gap-3">
            {/* Timer */}
            <button
              onClick={toggleTimer}
              className={`flex flex-1 items-center justify-between rounded-2xl px-4 py-3 transition ${
                running ? "bg-accent-600/20 ring-1 ring-accent-500/40" : "bg-white/[0.06] hover:bg-white/[0.09]"
              }`}
            >
              <span className={`text-3xl font-bold tabular-nums ${remaining === 0 ? "text-accent-400" : "text-white"}`}>
                {remaining === 0 ? "Done" : fmt(remaining)}
              </span>
              <span className="text-sm font-medium text-gray-300">
                {running ? "Pause" : remaining === DURATION ? "Start" : remaining === 0 ? "Again" : "Resume"}
              </span>
            </button>
            {remaining !== DURATION && (
              <button
                onClick={() => { setRunning(false); setRemaining(DURATION); }}
                className="rounded-2xl bg-white/[0.06] px-4 text-sm text-gray-400 hover:bg-white/[0.09]"
              >
                Reset
              </button>
            )}
          </div>

          {task.bpm && (
            <div className="flex items-center gap-2 rounded-2xl bg-white/[0.06] px-2 py-2">
              <button
                onClick={metro.toggle}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  metro.playing ? "bg-accent-600 text-white" : "text-gray-200 hover:bg-white/[0.06]"
                }`}
                aria-label={metro.playing ? "Stop click" : "Start click"}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${metro.playing && metro.currentBeat === 1 ? "bg-white" : metro.playing ? "bg-white/50" : "bg-accent-400"}`} />
                {metro.playing ? "Click on" : "Click"}
              </button>
              <span className="flex-1 text-center text-lg font-semibold tabular-nums text-white">
                {metro.bpm} <span className="text-sm font-normal text-gray-400">BPM{task.beats && task.beats !== 4 ? ` · ${task.beats}/8` : ""}</span>
              </span>
              <button
                onClick={() => metro.setBpm(Math.max(MIN_BPM, metro.bpm - 5))}
                className="rounded-xl px-3 py-2 text-sm text-gray-300 hover:bg-white/[0.06]"
                aria-label="Slower"
              >
                −5
              </button>
              <button
                onClick={() => metro.setBpm(Math.min(MAX_BPM, metro.bpm + 5))}
                className="rounded-xl px-3 py-2 text-sm text-gray-300 hover:bg-white/[0.06]"
                aria-label="Faster"
              >
                +5
              </button>
            </div>
          )}

          <button
            onClick={() => next()}
            className="w-full rounded-2xl bg-accent-600 py-3.5 text-[17px] font-semibold text-white transition hover:bg-accent-500 active:bg-accent-700"
          >
            Another task
          </button>
        </div>
      </div>
    </div>
  );
}
