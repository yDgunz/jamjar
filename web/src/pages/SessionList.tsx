import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError, formatDate, canAdmin } from "../api";
import type { Session } from "../api";
import FormModal from "../components/FormModal";
import GroupSelector from "../components/GroupSelector";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";

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
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [groupFilter, setGroupFilter] = useState<number | null>(() => {
    const stored = localStorage.getItem("session-list-group");
    if (stored) { const n = Number(stored); if (!isNaN(n)) return n; }
    return null;
  });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("Uploading...");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadGroupId, setUploadGroupId] = useState<number | null>(null);
  const [uploadThreshold, setUploadThreshold] = useState(20);
  const [singleSong, setSingleSong] = useState(false);
  const [duplicateDetected, setDuplicateDetected] = useState(false);
  const navigate = useNavigate();
  const multiGroup = user != null && user.groups.length > 1;

  useEffect(() => {
    if (groupFilter !== null) localStorage.setItem("session-list-group", String(groupFilter));
    else localStorage.removeItem("session-list-group");
  }, [groupFilter]);

  useEffect(() => {
    api.listSessions().then((data) => {
      setSessions(data);
      setLoading(false);
    });
  }, []);

  const openUploadModal = () => {
    setSelectedFile(null);
    setUploadThreshold(20);
    setSingleSong(false);
    // Pre-populate group: use filter if set, or auto-select if single group
    const groups = user?.groups ?? [];
    if (groups.length === 1) {
      setUploadGroupId(groups[0].id);
    } else if (groupFilter !== null) {
      setUploadGroupId(groupFilter);
    } else {
      setUploadGroupId(null);
    }
    setUploadError(null);
    setDuplicateDetected(false);
    setUploadModalOpen(true);
  };

  const doUpload = async (force?: boolean) => {
    if (!selectedFile) return;

    const groups = user?.groups ?? [];
    const groupId = groups.length === 1 ? groups[0].id : uploadGroupId;
    if (groups.length > 1 && !groupId) {
      setUploadError("Select a group");
      return;
    }

    setUploadModalOpen(false);
    setUploading(true);
    setUploadProgress(0);
    setUploadStatus("Uploading...");
    setUploadError(null);
    setDuplicateDetected(false);
    try {
      const threshold = uploadThreshold !== 20 ? -uploadThreshold : undefined;

      // Try presigned upload flow first
      const initResp = await api.initUpload(
        selectedFile.name, groupId ?? undefined, threshold, singleSong || undefined, force || undefined,
      );

      if (initResp.upload_url) {
        // Presigned R2 upload: PUT directly to R2
        const contentTypes: Record<string, string> = {
          ".m4a": "audio/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg",
          ".flac": "audio/flac", ".ogg": "audio/ogg",
        };
        const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf(".")).toLowerCase();
        const contentType = contentTypes[ext] || "application/octet-stream";

        await api.uploadToPresignedUrl(
          initResp.upload_url, selectedFile, contentType,
          (pct) => {
            setUploadProgress(pct);
            setUploadStatus(pct < 100 ? `Uploading... ${pct}%` : "Processing...");
          },
        );

        // Signal completion — server starts background processing
        await api.completeUpload(
          initResp.job.id, initResp.session_id, threshold, singleSong || undefined, force || undefined,
        );
        navigate(`/sessions/${initResp.session_id}?job=${initResp.job.id}`);
      } else {
        // Local storage fallback: use existing direct upload
        const job = await api.uploadSession(
          selectedFile, groupId ?? undefined, threshold, singleSong || undefined, force || undefined,
          (pct) => {
            setUploadProgress(pct);
            setUploadStatus(pct < 100 ? `Uploading... ${pct}%` : "Processing...");
          },
        );
        navigate(`/sessions/${job.session_id}?job=${job.id}`);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409 && err.message.includes("duplicate")) {
        setDuplicateDetected(true);
        setUploadError(err.message);
        setUploadModalOpen(true);
      } else {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
        setUploadModalOpen(true);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = () => doUpload();

  const filtered = sessions.filter((s) => {
    if (groupFilter !== null && s.group_id !== groupFilter) return false;
    if (filter.trim()) {
      const q = filter.toLowerCase();
      return (s.name || "").toLowerCase().includes(q)
        || (s.song_names || "").toLowerCase().includes(q);
    }
    return true;
  });

  if (loading) return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="h-8 w-44 animate-pulse rounded bg-gray-800" />
        <div className="ml-auto h-8 w-24 animate-pulse rounded bg-gray-800" />
      </div>
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
          <div className="flex w-72 flex-col items-center gap-4">
            {uploadProgress < 100 ? (
              <>
                <div className="w-full overflow-hidden rounded-full bg-gray-700">
                  <div
                    className="h-2 rounded-full bg-accent-500 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-lg text-gray-200">{uploadStatus}</p>
              </>
            ) : (
              <>
                <Spinner size="lg" className="text-accent-400" />
                <p className="text-lg text-gray-200">{uploadStatus}</p>
              </>
            )}
          </div>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {filterOpen ? (
          <input
            ref={filterInputRef}
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onBlur={() => { if (!filter) setFilterOpen(false); }}
            onKeyDown={(e) => { if (e.key === "Escape") { setFilter(""); setFilterOpen(false); } }}
            placeholder="Filter..."
            className="w-36 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:w-44 sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setFilterOpen(true)}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white"
            title="Filter sessions"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
            </svg>
          </button>
        )}
        <GroupSelector
          groups={user?.groups ?? []}
          value={groupFilter}
          onChange={setGroupFilter}
          allLabel="All groups"
        />
        {canAdmin(user) && (
          <div className="ml-auto">
            <button
              onClick={openUploadModal}
              disabled={uploading}
              className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-50"
              title="Upload"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 sm:hidden">
                <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z" />
                <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
              </svg>
              <span className="hidden sm:inline">Upload</span>
            </button>
          </div>
        )}
      </div>
      {sessions.length === 0 && (
        <p className="text-gray-400">
          No recordings yet. Upload a recording to get started.
        </p>
      )}
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
                  className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 transition hover:border-accent-500 hover:bg-gray-800"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-white">
                      {s.name || `Session ${s.id}`}
                      {multiGroup && !groupFilter && s.group_name && (
                        <span className="ml-2 text-xs font-normal text-gray-500">{s.group_name}</span>
                      )}
                    </div>
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
                  <div className="hidden shrink-0 text-right text-sm text-gray-400 sm:block">
                    {s.active_job_id ? (
                      <div className="flex items-center gap-2 text-accent-400">
                        <Spinner size="sm" />
                        Processing
                      </div>
                    ) : (
                      <>
                        <div>{s.track_count} track{s.track_count !== 1 ? "s" : ""}</div>
                        <div>
                          {s.tagged_count}/{s.track_count} tagged
                        </div>
                      </>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <FormModal
        open={uploadModalOpen}
        title="Upload Recording"
        error={uploadError}
        confirmLabel={duplicateDetected ? "Upload Anyway" : "Upload"}
        confirmDisabled={!duplicateDetected && (!selectedFile || (multiGroup && !uploadGroupId))}
        confirmVariant={duplicateDetected ? "warning" : "default"}
        onConfirm={duplicateDetected ? () => doUpload(true) : handleUpload}
        onCancel={() => setUploadModalOpen(false)}
      >
        <div>
          <input
            type="file"
            accept=".m4a,.wav,.mp3,.flac,.ogg"
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-gray-300 file:mr-3 file:rounded file:border-0 file:bg-gray-800 file:px-3 file:py-1.5 file:text-sm file:text-gray-300 hover:file:bg-gray-700"
          />
        </div>
        {multiGroup && (
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Group</label>
            <select
              value={uploadGroupId ?? ""}
              onChange={(e) => setUploadGroupId(e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
            >
              <option value="">Select a group...</option>
              {user!.groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={singleSong}
            onChange={(e) => setSingleSong(e.target.checked)}
            className="rounded border-gray-600 bg-gray-800 text-accent-500 focus:ring-accent-500 focus:ring-offset-0"
          />
          <span className="text-sm text-gray-300">Single song recording</span>
        </label>
        {!singleSong && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Threshold (dB)
          </label>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-gray-400">&minus;</span>
            <input
              type="number"
              value={uploadThreshold}
              onChange={(e) => setUploadThreshold(Number(e.target.value))}
              min={0}
              step={1}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
            />
            <span className="text-sm text-gray-500">dB</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Higher = more tracks, lower = fewer tracks
          </p>
        </div>
        )}
      </FormModal>
    </div>
  );
}
