import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import type { CurationRun } from "../api";

const ACTION_COUNTS: Record<string, [string, string]> = {
  added_song: ["new song", "new songs"],
  added_lesson: ["how-to video", "how-to videos"],
  added_backing_track: ["backing track", "backing tracks"],
  added_original: ["original recording", "original recordings"],
  added_tab: ["tab", "tabs"],
  added_background: ["history", "histories"],
  cleaned_chart: ["chart cleaned up", "charts cleaned up"],
  fixed_label: ["label fixed", "labels fixed"],
  updated_chart: ["chart replaced", "charts replaced"],
};

const ACTION_LABELS: Record<string, string> = {
  added_song: "New song",
  added_lesson: "How-to video",
  added_backing_track: "Backing track",
  added_original: "Original recording",
  added_tab: "Tab",
  added_background: "About",
  cleaned_chart: "Chart cleanup",
  fixed_label: "Label fix",
  updated_chart: "Chart replaced",
};

function when(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + "Z");
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** History of the scheduled library-curation routine, newest run first. */
export default function CurationHistory() {
  const [runs, setRuns] = useState<CurationRun[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api.adminGetCurationRuns().then(setRuns).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!runs) return <p className="text-sm text-gray-500">Loading...</p>;
  if (runs.length === 0) return <p className="text-sm text-gray-500">No curation runs yet.</p>;

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const counts: Record<string, number> = {};
        for (const i of run.items) counts[i.action] = (counts[i.action] || 0) + 1;
        const expanded = open === run.id;
        return (
          <div key={run.id} className="rounded-lg border border-gray-800">
            <button
              onClick={() => setOpen(expanded ? null : run.id)}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-gray-900/50"
            >
              <span className="w-28 shrink-0 text-xs leading-5 text-gray-500">{when(run.created_at)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-gray-200">{run.summary || "Run"}</span>
                {run.items.length > 0 && (
                  <span className="mt-0.5 block text-xs text-gray-500">
                    {Object.entries(counts)
                      .map(([a, n]) => `${n} ${ACTION_COUNTS[a]?.[n === 1 ? 0 : 1] ?? a}`)
                      .join(" · ")}
                  </span>
                )}
              </span>
              {run.items.length > 0 && (
                <svg className={`mt-1 h-4 w-4 shrink-0 text-gray-500 transition ${expanded ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            {expanded && (
              <ul className="divide-y divide-gray-800/50 border-t border-gray-800">
                {run.items.map((item, i) => (
                  <li key={i} className="flex items-baseline gap-3 px-3 py-1.5 text-sm">
                    <span className="w-28 shrink-0 text-xs text-gray-500">{ACTION_LABELS[item.action] || item.action}</span>
                    {item.song_id ? (
                      <Link to={`/songs/${item.song_id}`} className="text-gray-200 hover:text-white">{item.song_name}</Link>
                    ) : (
                      <span className="text-gray-300">{item.song_name}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
