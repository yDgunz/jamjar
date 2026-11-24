import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import type { StorageUsage as Usage } from "../api";

function bytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2.5">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

/** File storage (R2 bucket or local disk) usage, with the biggest recordings first. */
export default function StorageUsage() {
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = (refresh = false) => {
    setLoading(true);
    setError("");
    api.adminGetStorageUsage(refresh)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), []);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500">Listing storage…</p>;

  const max = data.recordings[0]?.total_bytes || 1;
  const rows = showAll ? data.recordings : data.recordings.slice(0, 25);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {data.backend === "r2" ? `Cloudflare R2 · bucket ${data.bucket}` : "Local disk"} · as of{" "}
          {new Date(data.computed_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </p>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="shrink-0 rounded bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Total stored" value={bytes(data.total_bytes)} sub={`${data.total_objects.toLocaleString()} files`} />
        <Stat label="Full recordings" value={bytes(data.recordings_source_bytes)} sub={`${data.recordings.length} recordings`} />
        <Stat label="Split tracks" value={bytes(data.recordings_track_bytes)} />
        <Stat
          label="Unreferenced"
          value={bytes(data.orphans.bytes)}
          sub={`${data.orphans.objects} files${data.missing_files ? ` · ${data.missing_files} missing` : ""}`}
        />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-300">By folder</h2>
        <div className="divide-y divide-gray-800/50 rounded-lg border border-gray-800">
          {data.prefixes.map((p) => (
            <div key={p.prefix} className="flex items-baseline justify-between px-3 py-2 text-sm">
              <span className="min-w-0 break-all font-mono text-gray-300">{p.prefix}/</span>
              <span className="shrink-0 pl-3 text-gray-400">
                {bytes(p.bytes)} <span className="text-xs text-gray-600">· {p.objects.toLocaleString()} files</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-300">Recordings by size</h2>
        <div className="divide-y divide-gray-800/50 rounded-lg border border-gray-800">
          {rows.map((r) => (
            <Link key={r.id} to={`/sessions/${r.id}`} className="block px-3 py-2 hover:bg-gray-900/50">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-gray-200">{r.name}</span>
                <span className="shrink-0 font-medium text-white">{bytes(r.total_bytes)}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded bg-gray-800">
                <div className="h-full bg-accent-600" style={{ width: `${(r.total_bytes / max) * 100}%` }} />
              </div>
              <div className="mt-1 text-xs text-gray-500">
                <span className="block truncate sm:inline">{[r.group_name, r.date].filter(Boolean).join(" · ")}</span>
                <span className="hidden sm:inline"> · </span>
                <span className="block sm:inline">
                  original {bytes(r.source_bytes)} · {r.track_count} {r.track_count === 1 ? "track" : "tracks"} {bytes(r.track_bytes)}
                </span>
              </div>
            </Link>
          ))}
        </div>
        {data.recordings.length > 25 && (
          <button onClick={() => setShowAll(!showAll)} className="mt-2 text-xs text-accent-400 hover:text-accent-300">
            {showAll ? "Show top 25" : `Show all ${data.recordings.length}`}
          </button>
        )}
      </div>
    </div>
  );
}
