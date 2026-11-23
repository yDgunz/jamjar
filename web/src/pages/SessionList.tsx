import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, ApiError, formatShortDate, canAdmin } from "../api";
import type { Session } from "../api";
import FetchError from "../components/FetchError";
import FormModal from "../components/FormModal";
import GroupSelector from "../components/GroupSelector";
import InlineSelect from "../components/InlineSelect";
import ListItemCard, { ListRows } from "../components/ListItemCard";
import PageHeader, { HeaderIconButton } from "../components/PageHeader";
import SearchInput from "../components/SearchInput";
import { ListSkeleton } from "../components/PageLoadingSkeleton";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { useFetch } from "../hooks/useFetch";

function formatMonthHeader(yearMonth: string): string {
  if (yearMonth === "unknown") return "Unknown Date";
  const [y, m] = yearMonth.split("-");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[Number(m) - 1]} ${y}`;
}

type SortBy = "date" | "uploaded";

function groupByMonth(sessions: Session[], sortBy: SortBy): [string, Session[]][] {
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    let key: string;
    if (sortBy === "uploaded") {
      key = s.created_at ? s.created_at.substring(0, 7) : "unknown";
    } else {
      key = s.date ? s.date.substring(0, 7) : "unknown";
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  // Sort sessions within each group
  for (const [, group] of groups) {
    group.sort((a, b) => {
      const aVal = sortBy === "uploaded" ? a.created_at : a.date;
      const bVal = sortBy === "uploaded" ? b.created_at : b.date;
      return (bVal ?? "").localeCompare(aVal ?? "");
    });
  }
  return Array.from(groups.entries());
}

export default function SessionList() {
  const { user } = useAuth();
  const { data: sessions, loading, error: fetchError, refresh: refreshSessions } = useFetch(
    () => api.listSessions(),
    [],
  );
  const [filter, setFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState<number | null>(() => {
    const stored = localStorage.getItem("group-filter");
    if (stored) { const n = Number(stored); if (!isNaN(n)) return n; }
    return null;
  });
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    const stored = localStorage.getItem("session-sort");
    return stored === "uploaded" ? "uploaded" : "date";
  });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("Uploading...");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadGroupId, setUploadGroupId] = useState<number | null>(null);
  const [uploadThreshold, setUploadThreshold] = useState<number | string>(20);
  const [singleSong, setSingleSong] = useState(false);
  const [duplicateDetected, setDuplicateDetected] = useState(false);
  const navigate = useNavigate();
  const multiGroup = user != null && user.groups.length > 1;

  useEffect(() => {
    if (groupFilter !== null) localStorage.setItem("group-filter", String(groupFilter));
    else localStorage.removeItem("group-filter");
  }, [groupFilter]);

  useEffect(() => {
    localStorage.setItem("session-sort", sortBy);
  }, [sortBy]);

  // sessions are fetched by useFetch above

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
      const thresholdNum = uploadThreshold === "" ? 20 : Number(uploadThreshold);
      const threshold = thresholdNum !== 20 ? -thresholdNum : undefined;

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

  const filtered = (sessions ?? []).filter((s) => {
    if (groupFilter !== null && s.group_id !== groupFilter) return false;
    if (filter.trim()) {
      const q = filter.toLowerCase();
      return (s.name || "").toLowerCase().includes(q)
        || (s.song_names || "").toLowerCase().includes(q);
    }
    return true;
  });

  if (loading) return <ListSkeleton rightSide="two-lines" />;
  if (fetchError) return <FetchError error={fetchError} onRetry={refreshSessions} />;

  const monthGroups = groupByMonth(filtered, sortBy);

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
      <PageHeader
        title="Recordings"
        actions={canAdmin(user) && (
          <HeaderIconButton label="Upload recording" onClick={openUploadModal} disabled={uploading}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z" />
              <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
            </svg>
          </HeaderIconButton>
        )}
      />
      <SearchInput value={filter} onChange={setFilter} placeholder="Search recordings or songs" />
      <div className="mt-2 flex items-center justify-end gap-4 text-sm text-gray-400">
        <GroupSelector
          groups={user?.groups ?? []}
          value={groupFilter}
          onChange={setGroupFilter}
          allLabel="All bands"
          variant="subtle"
        />
        <InlineSelect
          value={sortBy}
          options={[{ value: "date", label: "By date recorded" }, { value: "uploaded", label: "By date added" }] as { value: SortBy; label: string }[]}
          onChange={setSortBy}
          ariaLabel="Sort recordings"
        />
      </div>
      {(sessions ?? []).length === 0 && (
        <p className="mt-6 text-gray-400">
          No recordings yet.{canAdmin(user) ? " Upload one with the button above." : ""}
        </p>
      )}
      {(sessions ?? []).length > 0 && filtered.length === 0 && (
        <p className="mt-8 text-center text-gray-400">No recordings match “{filter.trim()}”.</p>
      )}
      <div className="space-y-5">
        {monthGroups.map(([month, group]) => (
          <section key={month}>
            <h2 className="sticky top-[env(safe-area-inset-top)] z-10 -mx-4 bg-gray-950/95 px-4 py-1.5 text-[13px] font-semibold uppercase tracking-wide text-gray-500 backdrop-blur sm:mx-0 sm:px-0">
              {formatMonthHeader(month)}
            </h2>
            <ListRows>
              {group.map((s) => {
                const names = s.song_names ? s.song_names.split(",") : [];
                const untagged = s.track_count - s.tagged_count;
                let songs = names.slice(0, 3).join(", ");
                if (names.length > 3) songs += ` +${names.length - 3}`;
                if (untagged > 0) songs += (songs ? " · " : "") + `${untagged} untagged`;
                const shownDate = sortBy === "uploaded" ? s.created_at : s.date;
                return (
                  <ListItemCard
                    key={s.id}
                    to={`/sessions/${s.id}`}
                    title={<>
                      {s.name || `Session ${s.id}`}
                      {multiGroup && !groupFilter && s.group_name && (
                        <span className="ml-2 text-sm font-normal text-gray-500">{s.group_name}</span>
                      )}
                    </>}
                    right={
                      s.active_job_id ? (
                        <div className="flex items-center gap-1.5 text-accent-400">
                          <Spinner size="sm" />
                          Processing
                        </div>
                      ) : (
                        <span className="text-gray-500">{formatShortDate(shownDate)}</span>
                      )
                    }
                  >
                    {songs && <div className="mt-0.5 truncate text-sm text-gray-400">{songs}</div>}
                  </ListItemCard>
                );
              })}
            </ListRows>
          </section>
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
        <button
          type="button"
          onClick={() => navigate("/import/drive")}
          className="flex w-full items-center justify-between rounded-md bg-gray-800 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-700"
        >
          <span>Import from Google Drive</span>
          <svg className="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
        </button>
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
              onChange={(e) => setUploadThreshold(e.target.value === "" ? "" : Number(e.target.value))}
              min={0}
              step={1}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
            />
            <span className="text-sm text-gray-500">dB</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Try 15 for loud rooms, 30 for quieter/acoustic.
          </p>
        </div>
        )}
      </FormModal>
    </div>
  );
}
