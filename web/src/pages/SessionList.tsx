import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, formatDate } from "../api";
import type { Session } from "../api";

function formatMonthHeader(yearMonth: string): string {
  if (yearMonth === "unknown") return "Unknown Date";
  const [y, m] = yearMonth.split("-");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[Number(m) - 1]} ${y}`;
}

function groupByMonth(sessions: Session[]): [string, Session[]][] {
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = s.date ? s.date.substring(0, 7) : "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return Array.from(groups.entries());
}

export default function SessionList() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.listSessions().then((data) => {
      setSessions(data);
      setLoading(false);
    });
  }, []);

  const filtered = filter.trim()
    ? sessions.filter((s) => {
        const q = filter.toLowerCase();
        return (s.name || s.source_file).toLowerCase().includes(q)
          || (s.song_names || "").toLowerCase().includes(q);
      })
    : sessions;

  if (loading) return <p className="text-gray-400">Loading sessions...</p>;

  if (sessions.length === 0) {
    return (
      <p className="text-gray-400">
        No sessions found. Run <code className="text-indigo-400">jam-session process-all input/</code> to get started.
      </p>
    );
  }

  const monthGroups = groupByMonth(filtered);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Sessions</h1>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter sessions..."
        className="mb-4 w-full max-w-sm rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
      />
      <div className="space-y-6">
        {monthGroups.map(([month, group]) => (
          <div key={month}>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-gray-500">
              {formatMonthHeader(month)}
            </h2>
            <div className="space-y-3">
              {group.map((s) => (
                <Link
                  key={s.id}
                  to={`/sessions/${s.id}`}
                  className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 transition hover:border-indigo-500 hover:bg-gray-800"
                >
                  <div>
                    <div className="font-medium text-white">{s.name || s.source_file}</div>
                    <div className="mt-1 text-sm text-gray-400">
                      {formatDate(s.date)}
                    </div>
                    {(s.song_names || s.track_count - s.tagged_count > 0) && (
                      <div className="mt-0.5 text-sm text-gray-500">
                        {(() => {
                          const names = s.song_names ? s.song_names.split(",") : [];
                          const untagged = s.track_count - s.tagged_count;
                          const shown = names.slice(0, 3);
                          const extra = names.length - 3;
                          let text = shown.join(", ");
                          if (extra > 0) text += `, +${extra + untagged} more`;
                          else if (untagged > 0) text += (text ? ", " : "") + `${untagged} untagged`;
                          return text;
                        })()}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-sm text-gray-400">
                    <div>{s.track_count} take{s.track_count !== 1 ? "s" : ""}</div>
                    <div>
                      {s.tagged_count}/{s.track_count} tagged
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
