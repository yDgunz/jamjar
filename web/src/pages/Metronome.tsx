import { useState, useEffect } from "react";
import { useMetronome, MIN_BPM, MAX_BPM } from "../hooks/useMetronome";
import ToolsHeader from "../components/ToolsHeader";

const LS_BPM_KEY = "metronome-bpm";
const LS_TIME_SIG_KEY = "metronome-time-sig";

const TIME_SIGNATURES = [2, 3, 4, 5, 6, 7] as const;

function loadBpm(): number {
  const stored = localStorage.getItem(LS_BPM_KEY);
  if (stored !== null) {
    const val = Number(stored);
    if (val >= MIN_BPM && val <= MAX_BPM) return val;
  }
  return 120;
}

function loadTimeSig(): number {
  const stored = localStorage.getItem(LS_TIME_SIG_KEY);
  if (stored !== null) {
    const val = Number(stored);
    if (TIME_SIGNATURES.includes(val as (typeof TIME_SIGNATURES)[number]))
      return val;
  }
  return 4;
}

export default function Metronome() {
  const metro = useMetronome();
  const [initialized, setInitialized] = useState(false);

  // Load persisted settings on mount
  useEffect(() => {
    metro.setBpm(loadBpm());
    metro.setBeatsPerMeasure(loadTimeSig());
    setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist settings
  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(LS_BPM_KEY, String(metro.bpm));
  }, [metro.bpm, initialized]);

  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(LS_TIME_SIG_KEY, String(metro.beatsPerMeasure));
  }, [metro.beatsPerMeasure, initialized]);

  // Spacebar to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        metro.toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [metro.toggle]);

  return (
    <div className="flex min-h-dvh flex-col bg-gray-950 text-gray-100">
      {/* Header */}
      <ToolsHeader active="Metronome" />

      {/* Body */}
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-[env(safe-area-inset-bottom)]">
        {/* Beat indicators */}
        <div className="flex items-center gap-3">
          {Array.from({ length: metro.beatsPerMeasure }, (_, i) => {
            const beatNum = i + 1;
            const isActive = metro.playing && metro.currentBeat === beatNum;
            const isAccent = beatNum === 1;
            return (
              <div
                key={i}
                className={`rounded-full transition-all duration-75 ${
                  isActive
                    ? isAccent
                      ? "bg-accent-400 scale-110"
                      : "bg-accent-500"
                    : "bg-gray-700"
                } ${isAccent ? "h-5 w-5" : "h-4 w-4"}`}
              />
            );
          })}
        </div>

        {/* BPM display */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-8xl font-bold tabular-nums">{metro.bpm}</span>
          <span className="text-sm text-gray-500">BPM</span>
        </div>

        {/* BPM slider */}
        <input
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          value={metro.bpm}
          onChange={(e) => metro.setBpm(Number(e.target.value))}
          className="w-full max-w-xs accent-accent-500"
        />

        {/* BPM adjust buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => metro.setBpm(metro.bpm - 5)}
            disabled={metro.bpm <= MIN_BPM}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-700 active:bg-gray-600 disabled:opacity-30"
          >
            -5
          </button>
          <button
            onClick={() => metro.setBpm(metro.bpm - 1)}
            disabled={metro.bpm <= MIN_BPM}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-700 active:bg-gray-600 disabled:opacity-30"
          >
            -1
          </button>
          <button
            onClick={() => metro.setBpm(metro.bpm + 1)}
            disabled={metro.bpm >= MAX_BPM}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-700 active:bg-gray-600 disabled:opacity-30"
          >
            +1
          </button>
          <button
            onClick={() => metro.setBpm(metro.bpm + 5)}
            disabled={metro.bpm >= MAX_BPM}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-700 active:bg-gray-600 disabled:opacity-30"
          >
            +5
          </button>
        </div>

        {/* Start/Stop + Tap tempo */}
        <div className="flex items-center gap-4">
          <button
            onClick={metro.tap}
            className="rounded-2xl border-2 border-gray-600 px-6 py-4 text-lg font-semibold text-gray-300 transition hover:border-gray-500 hover:text-white active:bg-gray-800"
          >
            Tap
          </button>
          <button
            onClick={metro.toggle}
            className={`rounded-2xl px-8 py-4 text-lg font-semibold text-white transition ${
              metro.playing
                ? "bg-red-600 hover:bg-red-500 active:bg-red-700"
                : "bg-accent-600 hover:bg-accent-500 active:bg-accent-700"
            }`}
          >
            {metro.playing ? "Stop" : "Start"}
          </button>
        </div>

        {/* Time signature */}
        <div className="flex items-center gap-2 rounded-xl bg-gray-900 px-3 py-2">
          <span className="text-xs text-gray-500">Beats</span>
          {TIME_SIGNATURES.map((n) => (
            <button
              key={n}
              onClick={() => metro.setBeatsPerMeasure(n)}
              className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
                metro.beatsPerMeasure === n
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
