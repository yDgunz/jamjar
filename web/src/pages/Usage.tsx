import { useState, useEffect } from "react";
import type { UsageStats } from "../api";
import { api, isSuperAdmin } from "../api";
import { useAuth } from "../context/AuthContext";

const EVENT_LABELS: Record<string, string> = {
  login: "Logins",
  upload: "Uploads",
  tag: "Tags",
  song_edit: "Song edits",
  setlist_create: "Setlists created",
  setlist_edit: "Setlist edits",
};

const EVENT_TYPES = Object.keys(EVENT_LABELS);

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso + "Z");
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso + "Z");
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays < 7) {
    const day = d.toLocaleDateString([], { weekday: "short" });
    return `${day} ${time}`;
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
}

function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

function eventAction(type: string): string {
  const actions: Record<string, string> = {
    login: "logged in",
    upload: "uploaded",
    tag: "tagged",
    song_edit: "edited song",
    setlist_create: "created setlist",
    setlist_edit: "edited setlist",
  };
  return actions[type] ?? type;
}

export default function Usage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.adminGetUsageStats().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (!isSuperAdmin(user)) {
    return (
      <div>
        <h1 className="mb-4 text-lg font-bold">Usage</h1>
        <p className="text-gray-400">You do not have permission to access this page.</p>
      </div>
    );
  }

  if (error) {
    return <p className="text-red-400 text-sm">{error}</p>;
  }

  if (!stats) {
    return <p className="text-gray-500 text-sm">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-white">Usage</h1>

      <div>
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900 text-left text-xs text-gray-400">
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Last active</th>
                {EVENT_TYPES.map((t) => (
                  <th key={t} className="px-3 py-2 text-center font-medium">{eventLabel(t)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {stats.users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-900/50">
                  <td className="px-3 py-2 text-white">{u.name || u.email}</td>
                  <td className="px-3 py-2 text-gray-400">{relativeTime(u.last_active_at)}</td>
                  {EVENT_TYPES.map((t) => (
                    <td key={t} className="px-3 py-2 text-center text-gray-300">
                      {u.event_counts[t] || 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent activity */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-300">Recent Activity</h2>
        {stats.recent_activity.length === 0 ? (
          <p className="text-sm text-gray-500">No activity yet.</p>
        ) : (
          <div className="space-y-1">
            {stats.recent_activity.map((a, i) => (
              <div key={i} className="flex items-baseline gap-2 rounded px-3 py-1.5 text-sm hover:bg-gray-900/50">
                <span className="text-gray-500 text-xs whitespace-nowrap">{formatTimestamp(a.created_at)}</span>
                <span className="text-gray-300">
                  <span className="text-white font-medium">{a.user_name}</span>
                  {" "}{eventAction(a.event_type)}
                  {a.detail && <span className="text-accent-400"> {a.detail}</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
