import { Link } from "react-router";

const TOOLS = [
  { to: "/tuner", label: "Tuner" },
  { to: "/metronome", label: "Metronome" },
  { to: "/practice", label: "Practice" },
] as const;

/** Header shared by the full-screen tools, with a back arrow and a switcher between them. */
export default function ToolsHeader({ active }: { active: (typeof TOOLS)[number]["label"] }) {
  return (
    <header className="border-b border-gray-800 px-3 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
      <div className="flex items-center gap-2">
        <Link to="/" className="shrink-0 p-2 text-lg text-gray-400 hover:text-white" title="Back">
          &larr;
        </Link>
        <div className="flex flex-1 justify-center">
          <div className="inline-flex rounded-lg bg-gray-900 p-0.5 text-sm">
            {TOOLS.map((t) =>
              t.label === active ? (
                <span key={t.to} className="rounded-md bg-gray-700 px-3 py-1.5 font-medium text-white sm:px-4">
                  {t.label}
                </span>
              ) : (
                <Link
                  key={t.to}
                  to={t.to}
                  className="rounded-md px-3 py-1.5 text-gray-400 transition hover:text-gray-200 sm:px-4"
                >
                  {t.label}
                </Link>
              ),
            )}
          </div>
        </div>
        <div className="w-10 shrink-0" />
      </div>
    </header>
  );
}
