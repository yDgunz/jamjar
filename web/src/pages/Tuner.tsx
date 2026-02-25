import { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import { useTuner } from "../hooks/useTuner";
import TunerGauge from "../components/TunerGauge";

const LS_A4_KEY = "tuner-a4";
const DEFAULT_A4 = 440;
const MIN_A4 = 415;
const MAX_A4 = 465;

function loadA4(): number {
  const stored = localStorage.getItem(LS_A4_KEY);
  if (stored !== null) {
    const val = Number(stored);
    if (val >= MIN_A4 && val <= MAX_A4) return val;
  }
  return DEFAULT_A4;
}

export default function Tuner() {
  const [a4, setA4] = useState(loadA4);
  const a4Ref = useRef(a4);
  useEffect(() => { a4Ref.current = a4; }, [a4]);
  useEffect(() => { localStorage.setItem(LS_A4_KEY, String(a4)); }, [a4]);

  const { listening, note, octave, cents, frequency, clarity, error, start, stop } = useTuner(a4Ref);

  // Auto-start on mount, cleanup on unmount
  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  const absCents = cents !== null ? Math.abs(cents) : null;
  const pitchDetected = note !== null && cents !== null;

  const centsColor =
    absCents !== null && absCents <= 5
      ? "text-green-400"
      : absCents !== null && absCents <= 20
        ? "text-yellow-400"
        : "text-gray-200";

  const statusText =
    absCents !== null && absCents <= 5
      ? "In tune"
      : cents !== null && cents > 0
        ? "Sharp"
        : cents !== null && cents < 0
          ? "Flat"
          : null;

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
          <h1 className="flex-1 text-center text-base font-bold">Tuner</h1>
          <div className="w-10 shrink-0" />
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-[env(safe-area-inset-bottom)]">
        {!listening ? (
          /* Starting / Error state */
          <div className="flex flex-col items-center gap-4">
            {error ? (
              <>
                <p className="max-w-xs text-center text-sm text-red-400">{error}</p>
                <button
                  onClick={start}
                  className="flex items-center gap-2 rounded-2xl bg-accent-600 px-8 py-4 text-lg font-semibold text-white transition hover:bg-accent-500 active:bg-accent-700"
                >
                  Try Again
                </button>
              </>
            ) : (
              <span className="animate-pulse text-sm text-gray-500">Starting mic...</span>
            )}
          </div>
        ) : (
          /* Listening state */
          <>
            {/* Note display */}
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-baseline gap-1">
                <span className={`text-7xl font-bold tabular-nums ${pitchDetected ? centsColor : "text-gray-600"}`}>
                  {note ?? "\u2014"}
                </span>
                {octave !== null && (
                  <span className="text-2xl text-gray-500">{octave}</span>
                )}
              </div>
              {statusText && (
                <span className={`text-sm font-medium ${centsColor}`}>{statusText}</span>
              )}
              {!pitchDetected && (
                <span className="animate-pulse text-sm text-gray-500">Listening...</span>
              )}
            </div>

            {/* Gauge */}
            <TunerGauge cents={cents} active={pitchDetected} />

            {/* Readouts */}
            <div className="flex items-center gap-6 text-sm text-gray-400">
              {cents !== null && (
                <span className="tabular-nums">
                  {cents > 0 ? "+" : ""}{cents} cents
                </span>
              )}
              {frequency !== null && (
                <span className="tabular-nums">{frequency.toFixed(1)} Hz</span>
              )}
              {clarity !== null && (
                <span className="tabular-nums">{Math.round(clarity * 100)}%</span>
              )}
            </div>

            {/* A4 reference */}
            <div className="flex items-center gap-2 rounded-xl bg-gray-900 px-3 py-2">
              <span className="text-xs text-gray-500">A4</span>
              <button
                onClick={() => setA4((v) => Math.max(MIN_A4, v - 1))}
                disabled={a4 <= MIN_A4}
                className="rounded-lg px-3 py-1 text-sm font-medium text-gray-300 hover:bg-gray-800 active:bg-gray-700 disabled:opacity-30"
              >
                -
              </button>
              <span className="min-w-[3ch] text-center text-sm font-medium tabular-nums">{a4} Hz</span>
              <button
                onClick={() => setA4((v) => Math.min(MAX_A4, v + 1))}
                disabled={a4 >= MAX_A4}
                className="rounded-lg px-3 py-1 text-sm font-medium text-gray-300 hover:bg-gray-800 active:bg-gray-700 disabled:opacity-30"
              >
                +
              </button>
            </div>

          </>
        )}
      </div>
    </div>
  );
}
