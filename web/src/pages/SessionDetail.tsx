import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { api, formatDate, canEdit, canAdmin } from "../api";
import type { Session, Track, Song } from "../api";
import AudioPlayer from "../components/AudioPlayer";
import type { Segment } from "../components/AudioPlayer";
import FormModal from "../components/FormModal";
import Modal, { Toast } from "../components/Modal";
import { DetailSkeleton } from "../components/PageLoadingSkeleton";
import Spinner from "../components/Spinner";
import Breadcrumb from "../components/Breadcrumb";
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12l7-4 7 4" />
              </svg>
              Merge with above
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
  const [threshold, setThreshold] = useState<number | string>(20);
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
    ]).then(([s, t]) => {
      setSession(s);
      setTracks(t);
      setNameInput(s?.name ?? "");
      setDateInput(s?.date ?? "");
      setNotesInput(s?.notes ?? "");
      setLoading(false);
      api.listSongs(s?.group_id).then(setSongs);
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
    api.listSongs(session?.group_id).then(setSongs);
  };

  const handleTracksChanged = (newTracks: Track[]) => {
    setTracks(newTracks);
    api.getSession(sessionId).then((s) => {
      setSession(s);
      setNameInput(s?.name ?? "");
      setDateInput(s?.date ?? "");
      setNotesInput(s?.notes ?? "");
    });
    api.listSongs(session?.group_id).then(setSongs);
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
    try {
      const thresholdNum = threshold === "" ? 20 : Number(threshold);
      const job = await api.reprocessSession(sessionId, -thresholdNum, 120, singleSong || undefined);
      // Update session with active job to trigger polling
      if (session) {
        setSession({ ...session, active_job_id: job.id });
      }
    } catch (err) {
      showError(`Reprocess failed: ${err instanceof Error ? err.message : err}`);
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

  if (loading) return <DetailSkeleton showDivider />;
  if (!session) return <p className="text-red-400">Recording not found.</p>;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Recordings", to: "/sessions" },
          { label: session.name || `Session ${session.id}` },
        ]}
        right={session.group_name && user && user.groups.length > 1 ? (
          canAdmin(user) ? (
            <select
              value={session.group_id}
              onChange={async (e) => {
                try {
                  const updated = await api.updateSessionGroup(sessionId, Number(e.target.value));
                  setSession(updated);
                  api.listSongs(updated.group_id).then(setSongs);
                } catch (err) {
                  showError(`Move failed: ${err instanceof Error ? err.message : err}`);
                }
              }}
              className="rounded-full border border-gray-700 bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-400 hover:border-gray-600 hover:text-gray-300 focus:border-accent-500 focus:outline-none"
            >
              {user!.groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          ) : (
            <span className="inline-block rounded-full border border-gray-700 bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-400">{session.group_name}</span>
          )
        ) : undefined}
      />
      <div>
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
                className="w-full max-w-lg rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xl font-bold text-white focus:border-accent-500 focus:outline-none"
              />
            ) : (
              <h1
                onClick={() => canEdit(user) && setEditingName(true)}
                className={`text-xl font-bold ${canEdit(user) ? "cursor-pointer hover:text-accent-400" : ""}`}
                title={canEdit(user) ? "Click to rename" : undefined}
              >
                {session.name || `Session ${session.id}`}
              </h1>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
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
                  className="rounded-md bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300 hover:bg-gray-700"
                  title="Click to change date"
                >
                  {formatDate(session.date)}
                </button>
              ) : (
                <span className="rounded-md bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300">{formatDate(session.date)}</span>
              )}
              {session.created_by_name && (
                <span className="rounded-md bg-gray-800/50 px-2.5 py-1 text-xs text-gray-500">by {session.created_by_name}</span>
              )}
            </div>
          </div>
          {canAdmin(user) && (
            <div className="flex shrink-0 items-center">
              <button
                onClick={() => setReprocessOpen(true)}
                disabled={!!processingProgress}
                className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-800 hover:text-gray-300 disabled:opacity-30"
                title="Reprocess"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg p-2 text-gray-500 transition hover:bg-red-950 hover:text-red-400"
                title="Delete"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
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
            durationSec={session.duration_sec ?? undefined}
            segments={tracks.map((t): Segment => ({
              startSec: t.start_sec,
              endSec: t.end_sec,
              label: `Track ${t.track_number}`,
            }))}
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
      ) : tracks.length === 0 && !loading ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 px-6 py-12 text-center">
          <p className="text-sm text-gray-300">No tracks were found in this recording.</p>
          <p className="text-xs text-gray-500 max-w-sm">
            The threshold may be too high for this recording. Try reprocessing with a lower threshold (e.g. 25 or 30), or use "Single song" mode if the recording is one continuous piece.
          </p>
          {canAdmin(user) && (
            <button
              onClick={() => setReprocessOpen(true)}
              className="mt-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
            >
              Reprocess
            </button>
          )}
        </div>
      ) : (
      <div className={tracks.length > 1 ? "space-y-0" : "mt-2 space-y-0"}>
        {tracks.map((t, i) => (
          <div key={t.id}>
            <TrackRow
              track={t}
              trackCount={tracks.length}
              sessionDuration={session?.duration_sec ?? null}
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
      <FormModal
        open={reprocessOpen}
        title="Reprocess"
        confirmLabel="Reprocess"
        onConfirm={handleReprocess}
        onCancel={() => setReprocessOpen(false)}
      >
        <p className="-mt-2 text-sm text-gray-400">
          Current tracks and tags will be replaced.
        </p>
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
              onChange={(e) => setThreshold(e.target.value === "" ? "" : Number(e.target.value))}
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
