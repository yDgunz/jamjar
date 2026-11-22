import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useNavigate, useSearchParams } from "react-router";
import { api, formatLongDate, formatShortDate, canEdit, canAdmin } from "../api";
import type { Session, Track, Song } from "../api";
import ActionSheet from "../components/ActionSheet";
import Artwork, { HeroBackdrop } from "../components/Artwork";
import type { SheetSection } from "../components/ActionSheet";
import { ListRows } from "../components/ListItemCard";
import FetchError from "../components/FetchError";
import FormModal from "../components/FormModal";
import Modal, { Toast } from "../components/Modal";
import { DetailSkeleton } from "../components/PageLoadingSkeleton";
import Spinner from "../components/Spinner";
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
  const [threshold, setThreshold] = useState<number | string>(20);
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [singleSong, setSingleSong] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingGroupId, setPendingGroupId] = useState<number | null>(null);
  const [processingProgress, setProcessingProgress] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
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

  const sheetSections: SheetSection[] = [];
  if (canEdit(user)) {
    sheetSections.push({ actions: [
      { label: "Rename", onClick: () => setEditingName(true) },
      { label: "Change date", onClick: () => setEditingDate(true) },
      { label: session.notes ? "Edit notes" : "Add notes", onClick: () => setEditingNotes(true) },
    ] });
  }
  if (canAdmin(user)) {
    sheetSections.push({
      title: "Manage",
      actions: [
        ...(multiGroup
          ? user!.groups.filter((g) => g.id !== session.group_id).map((g) => ({
              label: `Move to ${g.name}`,
              onClick: () => setPendingGroupId(g.id),
            }))
          : []),
        { label: "Re-split into tracks…", onClick: () => setReprocessOpen(true), disabled: !!processingProgress },
        { label: "Delete recording", destructive: true, onClick: () => setConfirmDelete(true) },
      ],
    });
  }

  return (
    <div>
      <div className="relative isolate -mx-4 -mt-3 px-4 pt-3 sm:mx-0 sm:px-0">
        <HeroBackdrop seed={`session-${session.id}`} />
        <Link to="/sessions" className="-ml-1 inline-flex items-center text-[15px] font-medium text-white/80 active:opacity-70">
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg>
          Recordings
        </Link>

        <div className="mt-3 flex animate-rise flex-col items-center text-center">
          <Artwork seed={`session-${session.id}`} size="lg" className="shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]">
            <div className="flex flex-col items-center leading-none text-white/95">
              <span className="text-[13px] font-bold uppercase tracking-[0.25em]">{formatShortDate(session.date).split(" ")[0]}</span>
              <span className="font-display mt-1 text-[84px]">{formatShortDate(session.date).split(" ")[1]?.replace(",", "")}</span>
            </div>
          </Artwork>

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
              className="font-display mt-6 w-full max-w-sm rounded-xl bg-white/[0.08] px-3 py-1 text-center text-[34px] text-white outline-none focus:ring-2 focus:ring-accent-500/60"
            />
          ) : (
            <h1 className="font-display mt-6 text-[42px] leading-[1.02] text-white">{sessionTitle}</h1>
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
              className="mt-2 rounded-xl bg-white/[0.08] px-3 py-1.5 text-base text-white outline-none"
            />
          ) : (
            <p className="mt-1.5 text-[15px] text-gray-300">{meta}</p>
          )}

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
              className="mt-4 w-full max-w-md rounded-xl bg-white/[0.08] px-3 py-2 text-base text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent-500/60"
            />
          ) : session.notes ? (
            <p className="font-display mt-3 max-w-md whitespace-pre-wrap text-[20px] italic leading-snug text-gray-200">“{session.notes}”</p>
          ) : null}

          <div className="mt-6 flex w-full max-w-sm items-center gap-3">
            {tracks.length > 0 && !processingProgress && (
              <button
                onClick={() => {
                  if (tracks.length > 1) {
                    player.play({
                      key: fullKey,
                      src: api.sessionAudioUrl(sessionId),
                      title: sessionTitle,
                      subtitle: `Full recording · ${formatLongDate(session.date)}`,
                      href: `/sessions/${sessionId}`,
                      durationSec: session.duration_sec ?? undefined,
                      artSeed: `session-${sessionId}`,
                    });
                  } else {
                    const t = tracks[0];
                    player.play({
                      key: `track:${t.id}`,
                      src: api.trackAudioUrl(t.id),
                      title: t.song_name ?? sessionTitle,
                      subtitle: sessionTitle,
                      durationSec: t.duration_sec,
                      trackId: t.id,
                      artSeed: t.song_id ? `song-${t.song_id}` : `session-${sessionId}`,
                    });
                  }
                }}
                className="btn-primary h-12 flex-1 text-[15px]"
              >
                {fullIsCurrent && player.playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
                {fullIsCurrent && player.playing ? "Pause" : tracks.length > 1 ? "Play full session" : "Play"}
              </button>
            )}
            {sheetSections.length > 0 && (
              <button onClick={() => setSheetOpen(true)} aria-label="Recording actions" className="btn-glass h-12 w-12 shrink-0">
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path d="M3 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM8.5 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM15.5 8.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {processingProgress ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <Spinner className="text-accent-400" />
          <p className="text-sm text-gray-400">{processingProgress}</p>
        </div>
      ) : tracks.length === 0 && !loading ? (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl bg-white/[0.04] px-6 py-10 text-center">
          <p className="text-[15px] text-gray-300">No songs were found in this recording.</p>
          <p className="max-w-sm text-sm text-gray-500">
            Try re-splitting with a lower threshold (e.g. 25 or 30), or as a single song if it’s one continuous piece.
          </p>
          {canAdmin(user) && (
            <button
              onClick={() => setReprocessOpen(true)}
              className="mt-2 rounded-full bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
            >
              Re-split
            </button>
          )}
        </div>
      ) : (
        <div className="relative mt-8">
          {merging && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-950/80">
              <div className="flex items-center gap-2 text-sm text-gray-300"><Spinner size="sm" /> Merging…</div>
            </div>
          )}
          <h2 className="font-display mb-2 mt-2 text-[26px] leading-none text-white">
            {tracks.length} track{tracks.length !== 1 ? "s" : ""}
            {tracks.some((t) => !t.song_name) && canEdit(user) && (
              <span className="font-sans text-sm text-gray-500"> · tap Tag to name a song</span>
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
        title="Re-split recording"
        confirmLabel="Re-split"
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
        open={pendingGroupId !== null}
        title="Move recording"
        message={`Move this recording to "${user?.groups.find(g => g.id === pendingGroupId)?.name}"? Tagged tracks will be relinked to matching songs in the new group (or new songs will be created).`}
        confirmLabel="Move"
        onConfirm={async () => {
          const gid = pendingGroupId!;
          setPendingGroupId(null);
          try {
            const updated = await api.updateSessionGroup(sessionId, gid);
            setSession(updated);
            api.listSongs(updated.group_id).then(setSongs);
          } catch (err) {
            showError(`Move failed: ${err instanceof Error ? err.message : err}`);
          }
        }}
        onCancel={() => setPendingGroupId(null)}
      />
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
