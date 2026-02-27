import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router";
import { api, formatDate, canEdit, canAdmin } from "../api";
import type { Session, Track, Song } from "../api";
import AudioPlayer from "../components/AudioPlayer";
import type { Marker } from "../components/AudioPlayer";
import Modal, { Toast } from "../components/Modal";
import Spinner from "../components/Spinner";
import TrackRow from "../components/TrackRow";
import { useAuth } from "../context/AuthContext";

function MergeButton({ trackId, nextTrackId, onTracksChanged, onError }: {
  trackId: number;
  nextTrackId: number;
  onTracksChanged: (tracks: Track[]) => void;
  onError: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleMerge = async () => {
    setConfirming(false);
    setLoading(true);
    try {
      const newTracks = await api.mergeTrack(trackId, nextTrackId);
      onTracksChanged(newTracks);
    } catch (err) {
      onError(`Merge failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-center py-0.5">
        <button
          onClick={() => setConfirming(true)}
          disabled={loading}
          className="flex items-center gap-1.5 rounded px-3 py-2 text-xs text-gray-600 transition hover:bg-gray-800 hover:text-gray-300 disabled:opacity-50"
          title="Merge with track above"
        >
          {loading ? (
            <>
              <Spinner size="sm" className="!h-3 !w-3" />
              Merging...
            </>
          ) : (
            <>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M7 8l5 4-5 4M17 8l-5 4 5 4" />
              </svg>
              Merge
            </>
          )}
        </button>
      </div>
      <Modal
        open={confirming}
        title="Merge tracks"
        message="Merge these two tracks into one? The first track's song tag and notes will be kept."
        confirmLabel="Merge"
        onConfirm={handleMerge}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

export default function SessionDetail() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(20);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [singleSong, setSingleSong] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<string | null>(null);
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const jobId = searchParams.get("job");
  const sessionId = Number(id);
  const showError = useCallback((msg: string) => setErrorMsg(msg), []);

  useEffect(() => {
    Promise.all([
      api.getSession(sessionId),
      api.getSessionTracks(sessionId),
      api.listSongs(),
    ]).then(([s, t, allSongs]) => {
      setSession(s);
      setTracks(t);
      setSongs(allSongs);
      setNameInput(s?.name ?? "");
      setDateInput(s?.date ?? "");
      setNotesInput(s?.notes ?? "");
      setLoading(false);
    });
  }, [sessionId]);

  // Poll a background job until tracks are ready.
  // Triggered by ?job= URL param (after upload) or session.active_job_id (navigating back).
  const activeJobId = jobId || session?.active_job_id;

  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    setProcessingProgress("Processing...");

    const poll = async () => {
      while (!cancelled) {
        try {
          const job = await api.getJob(activeJobId);
          if (cancelled) return;
          if (job.status === "completed") {
            const [s, t] = await Promise.all([
              api.getSession(sessionId),
              api.getSessionTracks(sessionId),
            ]);
            if (cancelled) return;
            setProcessingProgress(null);
            setSession(s);
            setTracks(t);
            setNameInput(s?.name ?? "");
            setDateInput(s?.date ?? "");
            setNotesInput(s?.notes ?? "");
            if (jobId) setSearchParams({}, { replace: true });
            return;
          }
          if (job.status === "failed") {
            setProcessingProgress(null);
            setErrorMsg(job.error || "Processing failed");
            if (jobId) setSearchParams({}, { replace: true });
            return;
          }
          if (job.progress) setProcessingProgress(job.progress);
        } catch {
          if (cancelled) return;
          setProcessingProgress(null);
          setErrorMsg("Lost connection to server");
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [activeJobId, sessionId, jobId, setSearchParams]);

  const refresh = () => {
    api.getSessionTracks(sessionId).then(setTracks);
    api.getSession(sessionId).then((s) => {
      setSession(s);
      setNameInput(s?.name ?? "");
      setDateInput(s?.date ?? "");
      setNotesInput(s?.notes ?? "");
    });
    api.listSongs().then(setSongs);
  };

  const handleTracksChanged = (newTracks: Track[]) => {
    setTracks(newTracks);
    api.getSession(sessionId).then((s) => {
      setSession(s);
      setNameInput(s?.name ?? "");
      setDateInput(s?.date ?? "");
      setNotesInput(s?.notes ?? "");
    });
    api.listSongs().then(setSongs);
  };

  const handleSaveName = async () => {
    await api.updateSessionName(sessionId, nameInput.trim());
    setEditingName(false);
    refresh();
  };

  const handleSaveDate = async () => {
    await api.updateSessionDate(sessionId, dateInput || null);
    setEditingDate(false);
    refresh();
  };

  const handleSaveSessionNotes = async () => {
    await api.updateSessionNotes(sessionId, notesInput.trim());
    setEditingNotes(false);
    refresh();
  };

  const handleReprocess = async () => {
    setReprocessOpen(false);
    setReprocessing(true);
    try {
      const newTracks = await api.reprocessSession(sessionId, -threshold, 120, singleSong || undefined);
      handleTracksChanged(newTracks);
      setSuccessMsg(`Reprocessed: ${newTracks.length} track${newTracks.length !== 1 ? "s" : ""} found`);
    } catch (err) {
      showError(`Reprocess failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setReprocessing(false);
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    try {
      await api.deleteSession(sessionId, true);
      navigate("/");
    } catch (err) {
      showError(`Delete failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  if (loading) return (
    <div>
      <div className="h-4 w-24 animate-pulse rounded bg-gray-800" />
      <div className="mt-4 mb-6 space-y-2">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-800" />
        <div className="h-4 w-48 animate-pulse rounded bg-gray-800" />
      </div>
      <div className="mb-3 flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-700" />
        <div className="h-4 w-12 animate-pulse rounded bg-gray-800" />
        <div className="h-px flex-1 bg-gray-700" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="h-5 w-32 animate-pulse rounded bg-gray-800" />
              <div className="h-4 w-20 animate-pulse rounded bg-gray-800" />
            </div>
            <div className="h-10 w-full animate-pulse rounded bg-gray-800" />
          </div>
        ))}
      </div>
    </div>
  );
  if (!session) return <p className="text-red-400">Recording not found.</p>;

  return (
    <div>
      {reprocessing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="flex flex-col items-center gap-4">
            <Spinner size="lg" className="text-accent-400" />
            <p className="text-lg text-gray-200">Reprocessing...</p>
          </div>
        </div>
      )}
      <Link to="/" className="text-sm text-accent-400 hover:text-accent-300">
        &larr; All Recordings
      </Link>

      <div className="mt-1">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {editingName && canEdit(user) ? (
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") { setEditingName(false); setNameInput(session.name); }
                }}
                onBlur={handleSaveName}
                className="w-full max-w-lg rounded border border-gray-700 bg-gray-800 px-2 py-1 text-lg font-bold text-white focus:border-accent-500 focus:outline-none"
              />
            ) : (
              <h1
                onClick={() => canEdit(user) && setEditingName(true)}
                className={`text-lg font-bold ${canEdit(user) ? "cursor-pointer hover:text-accent-400" : ""}`}
                title={canEdit(user) ? "Click to rename" : undefined}
              >
                {session.name || `Session ${session.id}`}
                {session.group_name && user && user.groups.length > 1 && canAdmin(user) ? (
                  <select
                    value={session.group_id}
                    onChange={async (e) => {
                      try {
                        const updated = await api.updateSessionGroup(sessionId, Number(e.target.value));
                        setSession(updated);
                        api.listSongs().then(setSongs);
                      } catch (err) {
                        showError(`Move failed: ${err instanceof Error ? err.message : err}`);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="ml-2 rounded border border-transparent bg-transparent py-0 text-base sm:text-sm font-normal text-gray-500 hover:border-gray-700 hover:text-gray-300 focus:border-accent-500 focus:outline-none"
                  >
                    {user!.groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                ) : session.group_name ? (
                  <span className="ml-2 text-sm font-normal text-gray-500">{session.group_name}</span>
                ) : null}
              </h1>
            )}
            <p className="mt-0.5 text-sm text-gray-400">
              {editingDate && canEdit(user) ? (
                <input
                  type="date"
                  autoFocus
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveDate();
                    if (e.key === "Escape") { setEditingDate(false); setDateInput(session.date ?? ""); }
                  }}
                  onBlur={handleSaveDate}
                  className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
                />
              ) : canEdit(user) ? (
                <button
                  onClick={() => setEditingDate(true)}
                  className="hover:text-accent-400"
                  title="Click to change date"
                >
                  {formatDate(session.date)}
                </button>
              ) : (
                <span>{formatDate(session.date)}</span>
              )}
              {" "}&middot; {session.track_count} track{session.track_count !== 1 ? "s" : ""} &middot;{" "}
              {session.tagged_count} tagged
            </p>
          </div>
          {canAdmin(user) && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setReprocessOpen(true)}
                disabled={!!processingProgress}
                className="rounded px-2 py-1.5 text-xs text-gray-500 transition hover:text-gray-300 disabled:opacity-30 disabled:hover:text-gray-500"
              >
                Reprocess
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded px-2 py-1.5 text-xs text-gray-500 transition hover:text-red-400"
              >
                Delete
              </button>
            </div>
          )}
        </div>

        <div className="mt-1">
          {editingNotes && canEdit(user) ? (
            <textarea
              autoFocus
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveSessionNotes(); }
                if (e.key === "Escape") { setEditingNotes(false); setNotesInput(session.notes ?? ""); }
              }}
              onBlur={handleSaveSessionNotes}
              placeholder="Add notes..."
              rows={3}
              className="w-full max-w-md rounded border border-gray-700 bg-gray-800 px-2 py-1 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
            />
          ) : session.notes ? (
            canEdit(user) ? (
              <button
                onClick={() => setEditingNotes(true)}
                className="text-left text-sm whitespace-pre-wrap text-gray-400 italic hover:text-gray-300"
              >
                {session.notes}
              </button>
            ) : (
              <p className="text-sm whitespace-pre-wrap text-gray-400 italic">{session.notes}</p>
            )
          ) : canEdit(user) ? (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-sm text-gray-600 hover:text-gray-400"
            >
              + add notes
            </button>
          ) : null}
        </div>

        {(tracks.length > 1 || processingProgress) && (
        <div className="mt-2 rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Full Recording</p>
          <AudioPlayer
            src={api.sessionAudioUrl(sessionId)}
            markers={tracks.flatMap((t): Marker[] => [
              { timeSec: t.start_sec, label: `Track ${t.track_number} start` },
              { timeSec: t.end_sec, label: `Track ${t.track_number} end` },
            ])}
          />
        </div>
        )}
      </div>

      {(tracks.length > 1 || processingProgress) && (
      <div className="mb-6 mt-8 flex items-center gap-3">
        <div className="h-px flex-1 bg-gray-700" />
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Tracks</span>
        <div className="h-px flex-1 bg-gray-700" />
      </div>
      )}

      {processingProgress ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <Spinner className="text-accent-400" />
          <p className="text-sm text-gray-400">{processingProgress}</p>
        </div>
      ) : (
      <div className={tracks.length > 1 ? "space-y-0" : "mt-2 space-y-0"}>
        {tracks.map((t, i) => (
          <div key={t.id}>
            <TrackRow
              track={t}
              trackCount={tracks.length}
              songs={songs}
              onUpdate={refresh}
              onTracksChanged={handleTracksChanged}
              onError={showError}
            />
            {i < tracks.length - 1 && canAdmin(user) && (
              <MergeButton
                trackId={t.id}
                nextTrackId={tracks[i + 1].id}
                onTracksChanged={handleTracksChanged}
                onError={showError}
              />
            )}
          </div>
        ))}
      </div>
      )}
      {reprocessOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onKeyDown={(e) => { if (e.key === "Escape") setReprocessOpen(false); }}
        >
          <div className="absolute inset-0 bg-black/60" onClick={() => setReprocessOpen(false)} />
          <div className="relative mx-4 w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 px-6 py-5 shadow-xl">
            <h3 className="text-sm font-semibold text-white">Reprocess</h3>
            <p className="mt-2 text-sm text-gray-400">
              Current tracks and tags will be replaced.
            </p>
            <div className="mt-4 space-y-4">
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
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
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
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setReprocessOpen(false)}
                className="rounded px-4 py-2 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleReprocess}
                className="rounded bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
              >
                Reprocess
              </button>
            </div>
          </div>
        </div>
      )}
      <Modal
        open={confirmDelete}
        title="Delete recording"
        message="Delete this recording and all its tracks? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
      {errorMsg && (
        <Toast message={errorMsg} variant="error" onClose={() => setErrorMsg(null)} />
      )}
      {successMsg && (
        <Toast message={successMsg} variant="success" onClose={() => setSuccessMsg(null)} />
      )}
    </div>
  );
}
