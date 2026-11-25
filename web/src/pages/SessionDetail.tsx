import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router";
import { api, formatLongDate, canEdit, canAdmin, SESSION_KINDS, SESSION_KIND_LABEL } from "../api";
import type { Job, Session, SessionKind, Track, Song } from "../api";
import ActionSheet, { MoreIcon } from "../components/ActionSheet";
import ShareDialog from "../share/ShareDialog";
import { ShareIcon } from "../share/ShareIcon";
import type { SheetSection } from "../components/ActionSheet";
import { ListRows } from "../components/ListItemCard";
import FetchError from "../components/FetchError";
import FormModal from "../components/FormModal";
import KindBadge from "../components/KindBadge";
import ManualSplitPanel from "../components/ManualSplitPanel";
import type { ManualSegment } from "../components/ManualSplitPanel";
import Modal, { Toast } from "../components/Modal";
import { DetailSkeleton } from "../components/PageLoadingSkeleton";
import Spinner from "../components/Spinner";
import SplitProgress from "../components/SplitProgress";
import TrackRow from "../components/TrackRow";
import { useAuth } from "../context/AuthContext";
import { formatTime, PauseIcon, PlayIcon, usePlayer } from "../context/PlayerContext";

export default function SessionDetail() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [singleSong, setSingleSong] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<number | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<string | null>(null);
  const [processingJob, setProcessingJob] = useState<Job | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<{ trackId: number; nextId: number } | null>(null);
  const [merging, setMerging] = useState(false);
  const player = usePlayer();
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const jobId = searchParams.get("job");
  const sessionId = Number(id);
  const showError = useCallback((msg: string) => setErrorMsg(msg), []);

  const loadSession = useCallback(() => {
    setLoading(true);
    setFetchError(null);
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
    }).catch((err) => {
      setFetchError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    });
  }, [sessionId]);

  useEffect(() => { loadSession(); }, [loadSession]);

  // Poll a background job until tracks are ready.
  // Triggered by ?job= URL param (after upload) or session.active_job_id (navigating back).
  const activeJobId = jobId || session?.active_job_id;

  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    setProcessingProgress("Processing...");
    setProcessingJob(null);

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
          setProcessingJob(job);
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

  // While the server is recognising the songs, keep checking: it re-cuts and tags the
  // tracks at the end of its run, not one by one.
  const tagging = activeJobId ? null : session?.tagging ?? null;
  const taggingActive = tagging !== null;
  useEffect(() => {
    if (!taggingActive) return;
    const timer = setInterval(() => {
      Promise.all([api.getSession(sessionId), api.getSessionTracks(sessionId)])
        .then(([s, t]) => {
          setSession(s);
          setTracks(t);
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [taggingActive, sessionId]);

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
      const job = await api.reprocessSession(sessionId, singleSong || undefined);
      // Update session with active job to trigger polling
      if (session) {
        setSession({ ...session, active_job_id: job.id });
      }
    } catch (err) {
      showError(`Reprocess failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleManualSplit = async (segments: ManualSegment[]) => {
    setManualSubmitting(true);
    try {
      if (player.item?.key === `session:${sessionId}` || tracks.some((t) => player.item?.trackId === t.id)) {
        player.close();
      }
      const job = await api.splitSessionManually(sessionId, segments.map((s) => [s.start, s.end]));
      setManualOpen(false);
      if (session) setSession({ ...session, active_job_id: job.id });
    } catch (err) {
      showError(`Split failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setManualSubmitting(false);
    }
  };

  const handleSetKind = async (kind: SessionKind) => {
    try {
      setSession(await api.updateSessionKind(sessionId, kind));
    } catch (err) {
      showError(`Couldn't set the type: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleMove = async () => {
    const gid = moveTarget;
    setMoveOpen(false);
    if (gid === null) return;
    try {
      const updated = await api.updateSessionGroup(sessionId, gid);
      setSession(updated);
      api.listSongs(updated.group_id).then(setSongs);
    } catch (err) {
      showError(`Move failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    try {
      await api.deleteSession(sessionId, true);
      navigate("/sessions");
    } catch (err) {
      showError(`Delete failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleMerge = async () => {
    if (!mergeTarget) return;
    const { trackId, nextId } = mergeTarget;
    setMergeTarget(null);
    setMerging(true);
    try {
      if (player.item?.trackId === trackId || player.item?.trackId === nextId) player.close();
      handleTracksChanged(await api.mergeTrack(trackId, nextId));
    } catch (err) {
      showError(`Merge failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setMerging(false);
    }
  };

  if (loading) return <DetailSkeleton showDivider />;
  if (fetchError) return <FetchError error={fetchError} onRetry={loadSession} />;
  if (!session) return <p className="text-red-400">Recording not found.</p>;

  const multiGroup = user != null && user.groups.length > 1;
  const sessionTitle = session.name || `Session ${session.id}`;
  const meta = [
    formatLongDate(session.date),
    session.duration_sec ? formatTime(session.duration_sec) : null,
    session.created_by_name ? `by ${session.created_by_name}` : null,
    multiGroup ? session.group_name : null,
  ].filter(Boolean).join(" · ");
  const fullKey = `session:${session.id}`;
  const fullIsCurrent = player.isCurrent(fullKey);
  const fullItem = {
    key: fullKey,
    src: api.sessionAudioUrl(sessionId),
    title: sessionTitle,
    subtitle: `Full recording · ${formatLongDate(session.date)}`,
    href: `/sessions/${sessionId}`,
    durationSec: session.duration_sec ?? undefined,
  };
  const otherBands = (user?.groups ?? []).filter((g) => g.id !== session.group_id);

  const sheetSections: SheetSection[] = [];
  if (canEdit(user)) {
    sheetSections.push({ actions: [
      { label: "Rename", onClick: () => setEditingName(true) },
      { label: "Change date", onClick: () => setEditingDate(true) },
      { label: session.notes ? "Edit notes" : "Add notes", onClick: () => setEditingNotes(true) },
    ] });
    sheetSections.push({
      title: "Type",
      actions: [
        ...SESSION_KINDS.map((k) => ({
          label: SESSION_KIND_LABEL[k],
          hint: session.kind === k ? "✓" : undefined,
          onClick: () => handleSetKind(k),
        })),
        ...(session.kind ? [{ label: "No type", onClick: () => handleSetKind("") }] : []),
      ],
    });
  }
  if (canAdmin(user)) {
    sheetSections.push({
      title: "Manage",
      actions: [
        ...(otherBands.length > 0
          ? [{
              label: "Move to another band…",
              hint: session.group_name,
              onClick: () => { setMoveTarget(null); setMoveOpen(true); },
            }]
          : []),
        { label: "Detect songs again…", onClick: () => setReprocessOpen(true), disabled: !!processingProgress },
        { label: "Split by hand…", onClick: () => setManualOpen(true), disabled: !!processingProgress },
        { label: "Delete recording", destructive: true, onClick: () => setConfirmDelete(true) },
      ],
    });
  }

  return (
    <div>
      <Link to="/sessions" className="-ml-1 hidden items-center sm:inline-flex text-[15px] text-accent-400 active:opacity-70">
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg>
        Recordings
      </Link>

      <div className="flex items-start gap-2 sm:mt-2">
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
              className="w-full rounded-lg bg-white/[0.08] px-2 py-1 text-[26px] font-bold text-white outline-none focus:ring-2 focus:ring-accent-500/60"
            />
          ) : (
            <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white">{sessionTitle}</h1>
          )}
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
              className="mt-1 rounded-lg bg-white/[0.08] px-2 py-1 text-base text-white outline-none"
            />
          ) : (
            <p className="mt-1 text-[15px] text-gray-400">
              <KindBadge kind={session.kind} className="mr-2" />
              {meta}
            </p>
          )}
        </div>
      </div>

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
          placeholder="Notes about this session…"
          rows={3}
          className="mt-3 w-full rounded-lg bg-white/[0.08] px-3 py-2 text-base text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent-500/60"
        />
      ) : session.notes ? (
        <p className="mt-3 whitespace-pre-wrap text-[15px] text-gray-300">{session.notes}</p>
      ) : null}

      {!processingProgress && (
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => player.play(fullItem)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/[0.08] py-3 text-[15px] font-semibold text-white transition hover:bg-white/[0.12] active:bg-white/[0.12]"
          >
            {fullIsCurrent && player.playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
            {fullIsCurrent && player.playing ? "Pause full recording" : "Play full recording"}
          </button>
          <button
            onClick={() => setShareOpen(true)}
            aria-label="Share recording"
            title="Share recording"
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/[0.08] px-4 py-3 text-[15px] font-medium text-gray-200 transition hover:bg-white/[0.12] active:bg-white/[0.12]"
          >
            <ShareIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Share</span>
          </button>
          {sheetSections.length > 0 && (
            <button
              onClick={() => setSheetOpen(true)}
              aria-label="More actions"
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/[0.08] px-4 py-3 text-[15px] font-medium text-gray-200 transition hover:bg-white/[0.12] active:bg-white/[0.12]"
            >
              <MoreIcon className="h-4 w-4" />
              More
            </button>
          )}
        </div>
      )}

      {manualOpen && canAdmin(user) && !processingProgress && (
        <ManualSplitPanel
          fullItem={fullItem}
          duration={session.duration_sec ?? 0}
          submitting={manualSubmitting}
          onSubmit={handleManualSplit}
          onCancel={() => setManualOpen(false)}
        />
      )}

      {processingProgress ? (
        <SplitProgress job={processingJob} fallbackText={processingProgress} />
      ) : tracks.length === 0 && !loading ? (
        manualOpen ? null : (
          <div className="mt-5 rounded-xl border border-dashed border-white/10 px-5 py-6 text-center">
            <p className="text-[15px] text-gray-200">This recording isn’t split into songs yet.</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
              You can still listen to the whole thing above.
              {canAdmin(user) && " Detect songs automatically, or mark them yourself while it plays."}
            </p>
            {canAdmin(user) && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => setReprocessOpen(true)}
                  className="rounded-full bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-500"
                >
                  Detect songs
                </button>
                <button
                  onClick={() => setManualOpen(true)}
                  className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-semibold text-gray-200 transition hover:bg-white/[0.12]"
                >
                  Split by hand
                </button>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="relative mt-5">
          {merging && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-950/80">
              <div className="flex items-center gap-2 text-sm text-gray-300"><Spinner size="sm" /> Merging…</div>
            </div>
          )}
          {tagging && (
            <div className="mb-3 flex items-start gap-2.5 rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-sm text-gray-300">
              <span className="mt-0.5"><Spinner size="sm" /></span>
              <p>
                {tagging.state === "queued"
                  ? "Waiting to recognise the songs."
                  : tagging.transcribed < tagging.total
                    ? `Recognising the songs: listened to ${tagging.transcribed} of ${tagging.total} tracks.`
                    : "Recognising the songs: almost done."}
                <span className="text-gray-500"> Tags appear when it finishes; tracks may be split or joined.</span>
              </p>
            </div>
          )}
          <h2 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-gray-500">
            {tracks.length} track{tracks.length !== 1 ? "s" : ""}
            {tracks.some((t) => !t.song_name) && canEdit(user) && (
              <span className="normal-case tracking-normal text-gray-600"> · tap Tag to name a song</span>
            )}
          </h2>
          <ListRows>
            {tracks.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                sessionName={sessionTitle}
                sessionDuration={session?.duration_sec ?? null}
                songs={songs}
                onUpdate={refresh}
                onTracksChanged={handleTracksChanged}
                onError={showError}
                onMergeNext={i < tracks.length - 1 && canAdmin(user)
                  ? () => setMergeTarget({ trackId: t.id, nextId: tracks[i + 1].id })
                  : undefined}
              />
            ))}
          </ListRows>
        </div>
      )}
      <ActionSheet
        open={sheetOpen}
        title={sessionTitle}
        subtitle={formatLongDate(session.date)}
        sections={sheetSections}
        onClose={() => setSheetOpen(false)}
      />
      <ShareDialog open={shareOpen} kind="session" id={session.id} title={sessionTitle} onClose={() => setShareOpen(false)} />
      <Modal
        open={mergeTarget !== null}
        title="Merge tracks"
        message="Merge this track with the next one? This track's song tag and notes are kept."
        confirmLabel="Merge"
        onConfirm={handleMerge}
        onCancel={() => setMergeTarget(null)}
      />
      <FormModal
        open={reprocessOpen}
        title="Detect songs"
        confirmLabel="Detect"
        onConfirm={handleReprocess}
        onCancel={() => setReprocessOpen(false)}
      >
        <p className="-mt-2 text-sm text-gray-400">
          Detect songs again. Current tracks, tags and notes will be replaced.
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
      </FormModal>
      <FormModal
        open={moveOpen}
        title="Move to another band"
        confirmLabel="Move"
        confirmDisabled={moveTarget === null}
        onConfirm={handleMove}
        onCancel={() => setMoveOpen(false)}
      >
        <div className="-mx-1 space-y-0.5">
          {otherBands.map((g) => (
            <label key={g.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
              <input
                type="radio"
                name="move-band"
                checked={moveTarget === g.id}
                onChange={() => setMoveTarget(g.id)}
                className="h-4 w-4 border-gray-600 bg-gray-800 text-accent-500 focus:ring-accent-500 focus:ring-offset-0"
              />
              <span className="text-sm text-gray-200">{g.name}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          Currently in {session?.group_name}. Tagged songs will also be listed for the new band.
        </p>
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
