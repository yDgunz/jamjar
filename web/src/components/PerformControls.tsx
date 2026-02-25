import type { PerformModeReturn } from "../hooks/usePerformMode";
import { FONT_SIZES, SPEED_MULTIPLIERS } from "../hooks/usePerformMode";

interface Props {
  hasSheet: boolean;
  perform: PerformModeReturn;
}

export default function PerformControls({ hasSheet, perform }: Props) {
  const {
    transpose, setTranspose,
    showSettings, setShowSettings,
    wrapText, setWrapText,
    fontIdx, setFontIdx,
    speedIdx, setSpeedIdx,
  } = perform;

  return (
    <div className="mt-1.5 flex items-center justify-center gap-x-2">
      {hasSheet && (
        <>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowSettings((v) => !v); }}
              className="relative rounded-lg px-2 py-1.5 text-gray-300 active:bg-gray-800"
              title="Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
              </svg>
              {transpose !== 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-indigo-500" />
              )}
            </button>
            {showSettings && (
              <>
                <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setShowSettings(false); }} />
                <div
                  className="absolute left-0 top-full z-20 mt-2 rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-400">Transpose</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTranspose((t) => ((t - 1) % 12 + 12) % 12)}
                      className="rounded-lg px-2.5 py-1 text-sm font-medium text-gray-300 active:bg-gray-800"
                    >
                      T-
                    </button>
                    <span className="min-w-[2ch] text-center text-sm tabular-nums text-gray-200">{transpose}</span>
                    <button
                      onClick={() => setTranspose((t) => (t + 1) % 12)}
                      className="rounded-lg px-2.5 py-1 text-sm font-medium text-gray-300 active:bg-gray-800"
                    >
                      T+
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-4">
                  <span className="text-sm text-gray-400">Word wrap</span>
                  <button
                    role="switch"
                    aria-checked={wrapText}
                    onClick={() => setWrapText((v) => !v)}
                    className={`relative h-6 w-10 rounded-full transition-colors ${wrapText ? "bg-indigo-600" : "bg-gray-700"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${wrapText ? "translate-x-4" : ""}`} />
                  </button>
                </div>
              </div>
              </>
            )}
          </div>
          <span className="mx-0.5 text-gray-800">|</span>
        </>
      )}
      <button
        onClick={() => setFontIdx((i) => Math.max(0, i - 1))}
        disabled={fontIdx === 0}
        className="rounded-lg px-2.5 py-1.5 text-base font-medium text-gray-300 active:bg-gray-800 disabled:opacity-30"
        title="Decrease font size"
      >
        A-
      </button>
      <button
        onClick={() => setFontIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}
        disabled={fontIdx === FONT_SIZES.length - 1}
        className="rounded-lg px-2.5 py-1.5 text-base font-medium text-gray-300 active:bg-gray-800 disabled:opacity-30"
        title="Increase font size"
      >
        A+
      </button>
      <span className="mx-0.5 text-gray-800">|</span>
      <button
        onClick={() => setSpeedIdx((i) => Math.max(0, i - 1))}
        disabled={speedIdx === 0}
        className="rounded-lg px-2 py-1.5 text-base font-bold leading-none text-gray-300 active:bg-gray-800 disabled:opacity-30"
        title="Slower scroll"
      >
        &#8722;
      </button>
      <span className="min-w-[3ch] text-center text-xs tabular-nums text-gray-400">
        {SPEED_MULTIPLIERS[speedIdx]}&times;
      </span>
      <button
        onClick={() => setSpeedIdx((i) => Math.min(SPEED_MULTIPLIERS.length - 1, i + 1))}
        disabled={speedIdx === SPEED_MULTIPLIERS.length - 1}
        className="rounded-lg px-2 py-1.5 text-base font-bold leading-none text-gray-300 active:bg-gray-800 disabled:opacity-30"
        title="Faster scroll"
      >
        +
      </button>
    </div>
  );
}
