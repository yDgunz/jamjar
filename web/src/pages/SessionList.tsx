import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
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
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("Uploading...");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.listSessions().then((data) => {
      setSessions(data);
      setLoading(false);
    });
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadStatus("Uploading...");
    setUploadError(null);
    const timer = setTimeout(() => setUploadStatus("Processing \u2014 this may take a minute..."), 2000);
    try {
      const session = await api.uploadSession(file);
      navigate(`/sessions/${session.id}`);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      clearTimeout(timer);
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const filtered = filter.trim()
    ? sessions.filter((s) => {
        const q = filter.toLowerCase();
        return (s.name || s.source_file).toLowerCase().includes(q)
          || (s.song_names || "").toLowerCase().includes(q);
      })
    : sessions;

  if (loading) return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="h-8 w-32 animate-pulse rounded bg-gray-800" />
        <div className="h-10 w-36 animate-pulse rounded bg-gray-800" />
      </div>
      <div className="mb-4 h-9 w-64 animate-pulse rounded bg-gray-800" />
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-5 py-4">
            <div className="space-y-2">
              <div className="h-5 w-48 animate-pulse rounded bg-gray-800" />
              <div className="h-4 w-28 animate-pulse rounded bg-gray-800" />
            </div>
            <div className="space-y-1 text-right">
              <div className="h-4 w-16 animate-pulse rounded bg-gray-800" />
              <div className="h-4 w-20 animate-pulse rounded bg-gray-800" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const monthGroups = groupByMonth(filtered);

  return (
    <div>
      {uploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="flex flex-col items-center gap-4">
            <svg className="h-8 w-8 animate-spin text-indigo-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-lg text-gray-200">{uploadStatus}</p>
          </div>
        </div>
      )}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <div className="flex items-center gap-3">
          {uploadError && (
            <span className="text-sm text-red-400">{uploadError}</span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".m4a,.wav,.mp3,.flac,.ogg"
            onChange={handleUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {uploading ? "Processing..." : "Upload Session"}
          </button>
        </div>
      </div>
      {sessions.length === 0 && (
        <p className="text-gray-400">
          No sessions yet. Upload a recording to get started.
        </p>
      )}
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter sessions..."
        className="mb-4 w-full max-w-sm rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
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
