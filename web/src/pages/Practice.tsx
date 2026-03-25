import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router";
import { useMetronome, MIN_BPM, MAX_BPM } from "../hooks/useMetronome";

// --- Scale definitions ---

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
type NoteName = (typeof NOTES)[number];

// Flat display names for notes that are commonly shown as flats
const DISPLAY_NAMES: Record<string, string> = {
  "C#": "Db",
  "D#": "Eb",
  "F#": "Gb",
  "G#": "Ab",
  "A#": "Bb",
};

function displayNote(note: NoteName, preferFlats: boolean): string {
  if (preferFlats && DISPLAY_NAMES[note]) return DISPLAY_NAMES[note];
  return note;
}

interface ScaleType {
  name: string;
  intervals: number[]; // semitone intervals from root
}

const SCALE_TYPES: ScaleType[] = [
  { name: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { name: "Natural Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { name: "Pentatonic Major", intervals: [0, 2, 4, 7, 9] },
  { name: "Pentatonic Minor", intervals: [0, 3, 5, 7, 10] },
  { name: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
  { name: "Harmonic Minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { name: "Melodic Minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
];

// Keys that prefer flat notation
const FLAT_KEYS = new Set(["F", "A#", "D#", "G#", "C#"]);

function getScaleNotes(root: NoteName, scale: ScaleType): NoteName[] {
  const rootIdx = NOTES.indexOf(root);
  return scale.intervals.map((i) => NOTES[(rootIdx + i) % 12]);
}

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Persistence ---
const LS_PREFIX = "practice-";

function loadNum(key: string, fallback: number, min: number, max: number): number {
  const val = Number(localStorage.getItem(LS_PREFIX + key));
  return val >= min && val <= max ? val : fallback;
}

// --- Component ---

type PracticePhase = "setup" | "playing" | "complete";

export default function Practice() {
  const metro = useMetronome();

  // Settings
  const [startBpm, setStartBpm] = useState(() => loadNum("startBpm", 60, MIN_BPM, MAX_BPM));
  const [targetBpm, setTargetBpm] = useState(() => loadNum("targetBpm", 120, MIN_BPM, MAX_BPM));
  const [bpmStep, setBpmStep] = useState(() => loadNum("bpmStep", 5, 1, 50));
  const [measuresPerStep, setMeasuresPerStep] = useState(() => loadNum("measures", 2, 1, 8));

  // Session state
  const [phase, setPhase] = useState<PracticePhase>("setup");
  const [currentRoot, setCurrentRoot] = useState<NoteName>("C");
  const [currentScale, setCurrentScale] = useState<ScaleType>(SCALE_TYPES[0]);
  const [currentBpm, setCurrentBpmDisplay] = useState(startBpm);
  const [measuresPlayed, setMeasuresPlayed] = useState(0);
  const [totalMeasures, setTotalMeasures] = useState(0);

  // Refs for the scheduler callback
  const phaseRef = useRef(phase);
  const measuresPlayedRef = useRef(0);
  const measuresPerStepRef = useRef(measuresPerStep);
  const currentBpmRef = useRef(startBpm);
  const targetBpmRef = useRef(targetBpm);
  const bpmStepRef = useRef(bpmStep);
  const beatCountRef = useRef(0);

  // Keep refs in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { measuresPerStepRef.current = measuresPerStep; }, [measuresPerStep]);
  useEffect(() => { targetBpmRef.current = targetBpm; }, [targetBpm]);
  useEffect(() => { bpmStepRef.current = bpmStep; }, [bpmStep]);

  // Track beats to count measures
  const prevBeatRef = useRef(0);
  useEffect(() => {
    if (phase !== "playing" || !metro.playing) return;

    const beat = metro.currentBeat;
    // Detect measure completion: beat wrapped back to 1
    if (beat === 1 && prevBeatRef.current > 1) {
      measuresPlayedRef.current += 1;
      setMeasuresPlayed(measuresPlayedRef.current);

      // Check if we should increase BPM
      if (measuresPlayedRef.current % measuresPerStepRef.current === 0) {
        const nextBpm = Math.min(currentBpmRef.current + bpmStepRef.current, targetBpmRef.current);
        if (nextBpm > currentBpmRef.current) {
          currentBpmRef.current = nextBpm;
          setCurrentBpmDisplay(nextBpm);
          metro.setBpm(nextBpm);
        } else if (currentBpmRef.current >= targetBpmRef.current) {
          // Reached target — play one more step then complete
          metro.stop();
          setPhase("complete");
        }
      }
    }
    prevBeatRef.current = beat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metro.currentBeat, metro.playing, phase]);

  // Persist settings
  useEffect(() => { localStorage.setItem(LS_PREFIX + "startBpm", String(startBpm)); }, [startBpm]);
  useEffect(() => { localStorage.setItem(LS_PREFIX + "targetBpm", String(targetBpm)); }, [targetBpm]);
  useEffect(() => { localStorage.setItem(LS_PREFIX + "bpmStep", String(bpmStep)); }, [bpmStep]);
  useEffect(() => { localStorage.setItem(LS_PREFIX + "measures", String(measuresPerStep)); }, [measuresPerStep]);

  const startPractice = useCallback(() => {
    const root = randomChoice(NOTES);
    const scale = randomChoice(SCALE_TYPES);
    setCurrentRoot(root);
    setCurrentScale(scale);
    setCurrentBpmDisplay(startBpm);
    currentBpmRef.current = startBpm;
    measuresPlayedRef.current = 0;
    beatCountRef.current = 0;
    prevBeatRef.current = 0;
    setMeasuresPlayed(0);

    const steps = Math.ceil((targetBpm - startBpm) / bpmStep) + 1;
    setTotalMeasures(steps * measuresPerStep);

    metro.setBpm(startBpm);
    setPhase("playing");
    metro.start();
  }, [startBpm, targetBpm, bpmStep, measuresPerStep, metro]);

  const stopPractice = useCallback(() => {
    metro.stop();
    setPhase("setup");
  }, [metro]);

  const nextScale = useCallback(() => {
    const root = randomChoice(NOTES);
    const scale = randomChoice(SCALE_TYPES);
    setCurrentRoot(root);
    setCurrentScale(scale);
    setCurrentBpmDisplay(startBpm);
    currentBpmRef.current = startBpm;
    measuresPlayedRef.current = 0;
    beatCountRef.current = 0;
    prevBeatRef.current = 0;
    setMeasuresPlayed(0);

    const steps = Math.ceil((targetBpm - startBpm) / bpmStep) + 1;
    setTotalMeasures(steps * measuresPerStep);

    metro.setBpm(startBpm);
    setPhase("playing");
    metro.start();
  }, [startBpm, targetBpm, bpmStep, measuresPerStep, metro]);

  // Spacebar to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        if (phase === "setup") startPractice();
        else if (phase === "playing") stopPractice();
        else nextScale();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, startPractice, stopPractice, nextScale]);

  const preferFlats = FLAT_KEYS.has(currentRoot);
  const scaleNotes = getScaleNotes(currentRoot, currentScale);
  const progress = totalMeasures > 0 ? Math.min(measuresPlayed / totalMeasures, 1) : 0;

  return (
    <div className="flex min-h-dvh flex-col bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-3 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="shrink-0 p-2 text-lg text-gray-400 hover:text-white"
            title="Back"
          >
            &larr;
          </Link>
          <div className="flex flex-1 justify-center">
            <div className="inline-flex rounded-lg bg-gray-900 p-0.5 text-sm">
              <Link
                to="/tuner"
                className="rounded-md px-4 py-1.5 text-gray-400 transition hover:text-gray-200"
              >
                Tuner
              </Link>
              <Link
                to="/metronome"
                className="rounded-md px-4 py-1.5 text-gray-400 transition hover:text-gray-200"
              >
                Metronome
              </Link>
              <span className="rounded-md bg-gray-700 px-4 py-1.5 font-medium text-white">
                Practice
              </span>
            </div>
          </div>
          <div className="w-10 shrink-0" />
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-[env(safe-area-inset-bottom)]">
        {phase === "setup" && (
          <>
            {/* Settings */}
            <div className="w-full max-w-sm space-y-4">
              <h2 className="text-center text-lg font-semibold text-gray-300">
                Scale Practice
              </h2>
              <p className="text-center text-sm text-gray-500">
                A random scale will be selected. The metronome speeds up automatically as you play.
              </p>

              <div className="space-y-3 rounded-xl bg-gray-900 p-4">
                <SettingRow label="Start BPM" value={startBpm}>
                  <input
                    type="range"
                    min={MIN_BPM}
                    max={MAX_BPM}
                    value={startBpm}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setStartBpm(v);
                      if (v > targetBpm) setTargetBpm(v);
                    }}
                    className="w-full accent-accent-500"
                  />
                </SettingRow>

                <SettingRow label="Target BPM" value={targetBpm}>
                  <input
                    type="range"
                    min={MIN_BPM}
                    max={MAX_BPM}
                    value={targetBpm}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setTargetBpm(v);
                      if (v < startBpm) setStartBpm(v);
                    }}
                    className="w-full accent-accent-500"
                  />
                </SettingRow>

                <SettingRow label="BPM increase" value={`+${bpmStep}`}>
                  <div className="flex gap-2">
                    {[1, 2, 5, 10].map((n) => (
                      <button
                        key={n}
                        onClick={() => setBpmStep(n)}
                        className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
                          bpmStep === n
                            ? "bg-gray-700 text-white"
                            : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                        }`}
                      >
                        +{n}
                      </button>
                    ))}
                  </div>
                </SettingRow>

                <SettingRow label="Measures per step" value={measuresPerStep}>
                  <div className="flex gap-2">
                    {[1, 2, 4, 8].map((n) => (
                      <button
                        key={n}
                        onClick={() => setMeasuresPerStep(n)}
                        className={`rounded-lg px-3 py-1 text-sm font-medium transition ${
                          measuresPerStep === n
                            ? "bg-gray-700 text-white"
                            : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </SettingRow>
              </div>
            </div>

            <button
              onClick={startPractice}
              className="rounded-2xl bg-accent-600 px-10 py-4 text-lg font-semibold text-white transition hover:bg-accent-500 active:bg-accent-700"
            >
              Start
            </button>
          </>
        )}

        {phase === "playing" && (
          <>
            {/* Scale display */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-5xl font-bold">
                {displayNote(currentRoot, preferFlats)} {currentScale.name}
              </span>
            </div>

            {/* Notes */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {scaleNotes.map((note, i) => (
                <span
                  key={i}
                  className="rounded-lg bg-gray-800 px-3 py-2 text-lg font-medium tabular-nums"
                >
                  {displayNote(note, preferFlats)}
                </span>
              ))}
              <span className="rounded-lg bg-gray-800 px-3 py-2 text-lg font-medium tabular-nums opacity-50">
                {displayNote(currentRoot, preferFlats)}
              </span>
            </div>

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
              <span className="text-7xl font-bold tabular-nums">{currentBpm}</span>
              <span className="text-sm text-gray-500">
                BPM &middot; target {targetBpm}
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full max-w-xs">
              <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                <div
                  className="h-full rounded-full bg-accent-500 transition-all duration-300"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-xs text-gray-500">
                <span>{startBpm} BPM</span>
                <span>{targetBpm} BPM</span>
              </div>
            </div>

            {/* Stop button */}
            <button
              onClick={stopPractice}
              className="rounded-2xl bg-red-600 px-8 py-4 text-lg font-semibold text-white transition hover:bg-red-500 active:bg-red-700"
            >
              Stop
            </button>
          </>
        )}

        {phase === "complete" && (
          <>
            <div className="flex flex-col items-center gap-2">
              <span className="text-2xl font-bold text-accent-400">
                Nice work!
              </span>
              <span className="text-4xl font-bold">
                {displayNote(currentRoot, preferFlats)} {currentScale.name}
              </span>
              <span className="text-gray-400">
                {startBpm} &rarr; {targetBpm} BPM
              </span>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={nextScale}
                className="rounded-2xl bg-accent-600 px-8 py-4 text-lg font-semibold text-white transition hover:bg-accent-500 active:bg-accent-700"
              >
                Next Scale
              </button>
              <button
                onClick={stopPractice}
                className="rounded-2xl border-2 border-gray-600 px-6 py-4 text-lg font-semibold text-gray-300 transition hover:border-gray-500 hover:text-white active:bg-gray-800"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SettingRow({
  label,
  value,
  children,
}: {
  label: string;
  value: string | number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm text-gray-400">{label}</span>
        <span className="text-sm font-medium tabular-nums">{value}</span>
      </div>
      {children}
    </div>
  );
}
