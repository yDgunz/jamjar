import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import type { DriveFile, DriveFolder, DriveInfo } from "../api";
import Breadcrumb from "../components/Breadcrumb";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";

function size(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const selectClass =
  "rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-base text-white focus:border-accent-500 focus:outline-none sm:text-sm";

type Progress = { state: "running" | "done" | "failed"; text: string; sessionId?: number | null };

/** Import recordings from Google Drive folders shared with JamJar's service account. */
export default function DriveImport() {
  const { user } = useAuth();
  const groups = user?.groups ?? [];
  const [info, setInfo] = useState<DriveInfo | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const [newUrl, setNewUrl] = useState("");
  const [newGroup, setNewGroup] = useState<number | null>(groups.length === 1 ? groups[0].id : null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const [openFolder, setOpenFolder] = useState<number | null>(null);

  const load = useCallback(() => {
    api.driveInfo()
      .then((i) => {
        setInfo(i);
        if (i.configured) return api.driveFolders().then((f) => {
          setFolders(f);
          if (f.length === 1) setOpenFolder(f[0].id);
        });
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const addFolder = async () => {
    setAdding(true);
    setAddError("");
    try {
      const f = await api.driveAddFolder(newUrl.trim(), newGroup);
      setFolders((prev) => [...prev, f].sort((a, b) => a.name.localeCompare(b.name)));
      setOpenFolder(f.id);
      setNewUrl("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const copyEmail = () => {
    if (!info?.service_account_email) return;
    navigator.clipboard?.writeText(info.service_account_email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div>
      <Breadcrumb items={[{ label: "Recordings", to: "/sessions" }, { label: "Google Drive" }]} />
      <PageHeader title="Import from Drive" />

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!info && !error && <Spinner className="text-accent-400" />}

      {info && !info.configured && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-300">
          Google Drive import isn't set up on this server yet. An admin needs to add a Google service
          account key (<code className="text-gray-400">JAM_GOOGLE_SERVICE_ACCOUNT</code>).
        </div>
      )}

      {info?.configured && (
        <div className="space-y-6">
          <section className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <p className="text-sm text-gray-300">
              In Google Drive, share the folder your recordings go in with this address (Viewer is
              enough), then paste the folder's link below.
            </p>
            <button
              onClick={copyEmail}
              className="mt-3 flex w-full items-center justify-between gap-2 rounded-md bg-gray-800 px-3 py-2 text-left text-sm hover:bg-gray-700"
            >
              <span className="min-w-0 truncate font-mono text-gray-100">{info.service_account_email}</span>
              <span className="shrink-0 text-xs text-accent-400">{copied ? "Copied" : "Copy"}</span>
            </button>
            <div className="mt-4 space-y-2">
              <input
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://drive.google.com/drive/folders/…"
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-base text-white placeholder:text-gray-600 focus:border-accent-500 focus:outline-none sm:text-sm"
              />
              <div className="flex items-center gap-2">
                <select
                  value={newGroup ?? ""}
                  onChange={(e) => setNewGroup(e.target.value ? Number(e.target.value) : null)}
                  className={`${selectClass} min-w-0 flex-1`}
                  aria-label="Default band"
                >
                  <option value="">Mixed bands</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <button
                  onClick={addFolder}
                  disabled={!newUrl.trim() || adding}
                  className="shrink-0 rounded-md bg-accent-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
                >
                  {adding ? "Linking…" : "Link folder"}
                </button>
              </div>
              {addError && <p className="text-sm text-red-400">{addError}</p>}
            </div>
          </section>

          {folders.map((f) => (
            <FolderPanel
              key={f.id}
              folder={f}
              open={openFolder === f.id}
              onToggle={() => setOpenFolder(openFolder === f.id ? null : f.id)}
              onChanged={(nf) => setFolders((prev) => prev.map((x) => (x.id === nf.id ? nf : x)))}
              onRemoved={() => setFolders((prev) => prev.filter((x) => x.id !== f.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderPanel({
  folder,
  open,
  onToggle,
  onChanged,
  onRemoved,
}: {
  folder: DriveFolder;
  open: boolean;
  onToggle: () => void;
  onChanged: (f: DriveFolder) => void;
  onRemoved: () => void;
}) {
  const { user } = useAuth();
  const groups = user?.groups ?? [];
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [bands, setBands] = useState<Record<string, number>>({});
  const [progress, setProgress] = useState<Record<string, Progress>>({});

  const loadFiles = useCallback(() => {
    setError("");
    api.driveFiles(folder.id).then(setFiles).catch((e) => setError(e.message));
  }, [folder.id]);
  useEffect(() => {
    if (open && !files) loadFiles();
  }, [open, files, loadFiles]);

  const pollJob = async (fileId: string, jobId: string) => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const job = await api.getJob(jobId).catch(() => null);
      if (!job) continue;
      if (job.status === "completed") {
        setProgress((p) => ({ ...p, [fileId]: { state: "done", text: "Imported", sessionId: job.session_id } }));
        return;
      }
      if (job.status === "failed") {
        setProgress((p) => ({ ...p, [fileId]: { state: "failed", text: job.error || "Import failed" } }));
        return;
      }
      setProgress((p) => ({ ...p, [fileId]: { state: "running", text: job.progress || "Working…" } }));
    }
  };

  const importFile = async (file: DriveFile) => {
    const groupId = bands[file.id] ?? folder.group_id;
    if (!groupId) return;
    setProgress((p) => ({ ...p, [file.id]: { state: "running", text: "Starting…" } }));
    try {
      const job = await api.driveImport(file.id, groupId);
      pollJob(file.id, job.id);
    } catch (e) {
      setProgress((p) => ({ ...p, [file.id]: { state: "failed", text: e instanceof Error ? e.message : String(e) } }));
    }
  };

  const skip = async (file: DriveFile, skipped: boolean) => {
    await api.driveSkip(file.id, file.name, skipped);
    setFiles((prev) => prev?.map((f) => (f.id === file.id ? { ...f, status: skipped ? "skipped" : "new" } : f)) ?? null);
  };

  const remove = async () => {
    if (!confirm(`Unlink "${folder.name}"? Recordings already imported stay in JamJar.`)) return;
    await api.driveRemoveFolder(folder.id);
    onRemoved();
  };

  const isNew = (f: DriveFile) => f.status === "new" || progress[f.id];
  const newCount = files?.filter((f) => f.status === "new").length ?? 0;
  const shown = files?.filter((f) => showAll || isNew(f)) ?? [];

  return (
    <section className="rounded-lg border border-gray-800">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-gray-900/50">
        <svg className="h-5 w-5 shrink-0 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
          <path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75ZM3.75 9A1.75 1.75 0 0 0 2 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 15.25v-4.5A1.75 1.75 0 0 0 16.25 9H3.75Z" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-white">{folder.name}</span>
          <span className="block text-xs text-gray-500">
            {folder.group_name ?? "Mixed bands"}
            {files ? ` · ${newCount} new` : ""}
          </span>
        </span>
        <svg className={`h-4 w-4 shrink-0 text-gray-500 transition ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-800">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-sm text-gray-400">
            <label className="flex items-center gap-2">
              <span className="text-xs">Band</span>
              <select
                value={folder.group_id ?? ""}
                onChange={(e) =>
                  api.driveSetFolderGroup(folder.id, e.target.value ? Number(e.target.value) : null).then(onChanged)
                }
                className={selectClass}
              >
                <option value="">Mixed (per file)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>
            <button onClick={() => setShowAll(!showAll)} className="hover:text-gray-200">
              {showAll ? "Show new only" : "Show all"}
            </button>
            <button onClick={loadFiles} className="hover:text-gray-200">Refresh</button>
            <button onClick={remove} className="ml-auto text-red-400/80 hover:text-red-300">Unlink</button>
          </div>

          {error && <p className="px-3 pb-3 text-sm text-red-400">{error}</p>}
          {!files && !error && (
            <div className="px-3 pb-4"><Spinner className="text-accent-400" /></div>
          )}
          {files && shown.length === 0 && (
            <p className="px-3 pb-4 text-sm text-gray-500">
              {files.length === 0 ? "No audio files in this folder." : "Everything here is already imported or skipped."}
            </p>
          )}

          <ul className="divide-y divide-gray-800/60">
            {shown.map((f) => {
              const p = progress[f.id];
              const band = bands[f.id] ?? folder.group_id ?? null;
              return (
                <li key={f.id} className="px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words text-sm text-gray-100">{f.name}</span>
                    <span className="shrink-0 text-xs text-gray-500">{size(f.size)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {[f.path.join(" / "), shortDate(f.suggested_date ?? f.created_time)].filter(Boolean).join(" · ")}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {p ? (
                      <span
                        className={`flex items-center gap-2 text-sm ${p.state === "failed" ? "text-red-400" : p.state === "done" ? "text-accent-400" : "text-gray-300"}`}
                      >
                        {p.state === "running" && <Spinner className="text-accent-400" />}
                        {p.state === "done" && p.sessionId ? (
                          <Link to={`/sessions/${p.sessionId}`} className="underline underline-offset-2">Imported — open recording</Link>
                        ) : (
                          p.text
                        )}
                      </span>
                    ) : f.status === "new" ? (
                      <>
                        {folder.group_id === null && (
                          <select
                            value={band ?? ""}
                            onChange={(e) => setBands((b) => ({ ...b, [f.id]: Number(e.target.value) }))}
                            className={selectClass}
                            aria-label="Band"
                          >
                            <option value="" disabled>Band…</option>
                            {groups.map((g) => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                        )}
                        <button
                          onClick={() => importFile(f)}
                          disabled={!band}
                          className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-500 disabled:opacity-40"
                        >
                          Import
                        </button>
                        <button onClick={() => skip(f, true)} className="px-2 py-1.5 text-sm text-gray-400 hover:text-gray-200">
                          Skip
                        </button>
                      </>
                    ) : f.status === "skipped" ? (
                      <>
                        <span className="text-sm text-gray-500">Skipped</span>
                        <button onClick={() => skip(f, false)} className="text-sm text-accent-400 hover:text-accent-300">Undo</button>
                      </>
                    ) : f.session_id ? (
                      <Link to={`/sessions/${f.session_id}`} className="text-sm text-gray-400 hover:text-gray-200">
                        {f.status === "duplicate" ? "Already in JamJar" : "Imported"} · {f.session_name}
                      </Link>
                    ) : (
                      <span className="text-sm text-gray-500">{f.status === "duplicate" ? "Already in JamJar" : "Imported"}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
