import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import type { Session } from "../api";

export default function SessionList() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listSessions().then((data) => {
      setSessions(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <p className="text-gray-400">Loading sessions...</p>;

  if (sessions.length === 0) {
    return (
      <p className="text-gray-400">
        No sessions found. Run <code className="text-indigo-400">jam-session process-all input/</code> to get started.
      </p>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Sessions</h1>
      <div className="space-y-3">
        {sessions.map((s) => (
          <Link
            key={s.id}
            to={`/sessions/${s.id}`}
            className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 transition hover:border-indigo-500 hover:bg-gray-800"
          >
            <div>
              <div className="font-medium text-white">{s.name || s.source_file}</div>
              <div className="mt-1 text-sm text-gray-400">
                {s.date ?? "Unknown date"}
              </div>
            </div>
            <div className="text-right text-sm text-gray-400">
              <div>{s.track_count} track{s.track_count !== 1 ? "s" : ""}</div>
              <div>
                {s.tagged_count}/{s.track_count} tagged
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
