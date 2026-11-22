import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { api, formatLongDate, formatShortDate, canEdit, canAdmin } from "../api";
import type { Song, SongTrack } from "../api";
import ActionSheet, { MoreButton } from "../components/ActionSheet";
import Artwork, { HeroBackdrop } from "../components/Artwork";
import type { SheetAction, SheetSection } from "../components/ActionSheet";
import ChordSheet from "../components/ChordSheet";
import { ListRows } from "../components/ListItemCard";
import EditableField from "../components/EditableField";
import FetchError from "../components/FetchError";
import Modal, { Toast } from "../components/Modal";
import { DetailSkeleton } from "../components/PageLoadingSkeleton";
import { useAuth } from "../context/AuthContext";
import { formatTime, PauseIcon, PlayIcon, usePlayer } from "../context/PlayerContext";
import { isChordPro, toChordPro } from "../utils/chordpro";


function TakeRow({ take, songId, songName, onUpdate, readOnly, onError }: {
  take: SongTrack;
  songId: number;
  songName: string;
  onUpdate: () => void;
  readOnly?: boolean;
  onError?: (msg: string) => void;
}) {
  const player = usePlayer();
  const key = `track:${take.id}`;
  const isCurrent = player.isCurrent(key);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState(take.notes ?? "");
  const sessionName = take.session_name || `Session ${take.session_id}`;

  const handleSaveNotes = async () => {
    await api.updateTrackNotes(take.id, notesInput.trim());
    setEditingNotes(false);
    onUpdate();
  };

  const handleShare = async () => {
    try {
      const result = await api.createShareLink(take.id);
      const fullUrl = `${window.location.origin}${result.url}`;
      if (navigator.share) await navigator.share({ title: songName, url: fullUrl });
      else await navigator.clipboard.writeText(fullUrl);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      onError?.(`Share failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const play = () => player.play({
    key,
    src: api.trackAudioUrl(take.id),
    title: songName,
    subtitle: `${sessionName} · ${formatShortDate(take.session_date)}`,
    durationSec: take.duration_sec,
    trackId: take.id,
    artSeed: `song-${songId}`,
  });

  const actions: SheetAction[] = [
    { label: "Go to recording", href: `/sessions/${take.session_id}` },
    ...(!readOnly ? [{ label: take.notes ? "Edit notes" : "Add notes", onClick: () => setEditingNotes(true) }] : []),
    { label: "Share link", onClick: handleShare },
    { label: "Download", href: `${api.trackAudioUrl(take.id)}?download=1`, download: `${songName}.m4a` },
  ];

  return (
    <div>
      <div className="-mx-4 flex items-center gap-1 px-4 sm:mx-0 sm:px-0">
        <button onClick={play} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left active:opacity-70">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isCurrent ? "bg-accent-600 text-white" : "bg-white/[0.08] text-gray-200"}`}>
            {isCurrent && player.playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="ml-0.5 h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[17px] leading-snug sm:text-base ${isCurrent ? "font-medium text-accent-400" : "text-white"}`}>
              {formatLongDate(take.session_date)}
            </span>
            <span className="block truncate text-sm text-gray-500">
              {sessionName} · <span className="tabular-nums">{formatTime(take.duration_sec)}</span>
              {take.notes && <span className="italic text-gray-400"> · {take.notes}</span>}
            </span>
          </span>
        </button>
        <MoreButton onClick={() => setSheetOpen(true)} label="Take actions" />
      </div>
      {editingNotes && !readOnly && (
        <div className="mb-3 ml-12">
          <textarea
            autoFocus
            value={notesInput}
            onChange={(e) => setNotesInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSaveNotes(); }
              if (e.key === "Escape") { setEditingNotes(false); setNotesInput(take.notes ?? ""); }
            }}
            onBlur={handleSaveNotes}
            placeholder="Notes about this take…"
            rows={2}
            className="w-full rounded-lg bg-white/[0.08] px-3 py-2 text-base text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent-500/60"
          />
        </div>
      )}
      <ActionSheet
        open={sheetOpen}
        title={songName}
        subtitle={`${sessionName} · ${formatLongDate(take.session_date)}`}
        sections={[{ actions }]}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}

export default function SongHistory() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const songId = Number(id);
  const [song, setSong] = useState<Song | null>(null);
  const [takes, setTakes] = useState<SongTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [pendingGroupId, setPendingGroupId] = useState<number | null>(null);

  const [editingArtist, setEditingArtist] = useState(false);
  const [artistInput, setArtistInput] = useState("");
  const [fetchingLyrics, setFetchingLyrics] = useState(false);
  const [editingSheet, setEditingSheet] = useState(false);
  const [sheetInput, setSheetInput] = useState("");
  const [tab, setTab] = useState<"chart" | "takes" | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editingNotesField, setEditingNotesField] = useState(false);
  const player = usePlayer();

  const loadSong = useCallback(() => {
    setLoading(true);
    setFetchError(null);
    Promise.all([api.getSong(songId), api.getSongTracks(songId)]).then(
      ([songData, trackData]) => {
        setSong(songData);
        setNameInput(songData.name);
        setArtistInput(songData.artist);
        setSheetInput(songData.sheet ?? "");
        setTakes(trackData);
        setLoading(false);
      }
    ).catch((err) => {
      setFetchError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    });
  }, [songId]);

  useEffect(() => { loadSong(); }, [loadSong]);

  const refresh = () => {
    api.getSongTracks(songId).then(setTakes);
    api.getSong(songId).then((s) => {
      setSong(s);
      setNameInput(s.name);
      setArtistInput(s.artist);
      setSheetInput(s.sheet ?? "");
    });
  };

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === song?.name) {
      setEditingName(false);
      setNameInput(song?.name ?? "");
      return;
    }
    try {
      await api.renameSong(songId, trimmed);
      setEditingName(false);
      refresh();
    } catch (err) {
      setErrorMsg(`Rename failed: ${err instanceof Error ? err.message : err}`);
      setNameInput(song?.name ?? "");
      setEditingName(false);
    }
  };

  const handleSaveField = async (field: string, value: string) => {
    if (!song) return;
    try {
      const updated = await api.updateSongDetails(songId, {
        artist: field === "artist" ? value : song.artist,
        sheet: field === "sheet" ? value : song.sheet,
        notes: field === "notes" ? value : song.notes,
      });
      setSong(updated);
      if (field === "artist") setArtistInput(updated.artist);
    } catch (err) {
      setErrorMsg(`Save failed: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleSaveArtist = async () => {
    const trimmed = artistInput.trim();
    setEditingArtist(false);
    if (trimmed !== (song?.artist ?? "")) {
      await handleSaveField("artist", trimmed);
    }
  };

  const [showFetchConfirm, setShowFetchConfirm] = useState(false);

  const handleFetchLyrics = () => {
    if (!song) return;
    const currentSheet = editingSheet ? sheetInput : song.sheet;
    if (currentSheet) {
      setShowFetchConfirm(true);
      return;
    }
    doFetchLyrics();
  };

  const doFetchLyrics = async () => {
    setShowFetchConfirm(false);
    setFetchingLyrics(true);
    try {
      const result = await api.fetchLyrics(songId);
      setSong(result.song);
      setSheetInput(result.song.sheet ?? "");
    } catch (err) {
      setErrorMsg(`Fetch lyrics failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setFetchingLyrics(false);
    }
  };

  const handleSaveSheet = async () => {
    setEditingSheet(false);
    if (sheetInput.trim() !== (song?.sheet ?? "")) {
      await handleSaveField("sheet", sheetInput.trim());
    }
  };

  const handleCancelSheet = () => {
    setEditingSheet(false);
    setSheetInput(song?.sheet ?? "");
  };

  const handleConvertToChordPro = () => {
    if (!song) return;
    const currentSheet = editingSheet ? sheetInput : song.sheet;
    if (!currentSheet || isChordPro(currentSheet)) return;
    const converted = toChordPro(currentSheet);
    if (editingSheet) {
      setSheetInput(converted);
    } else {
      handleSaveField("sheet", converted);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deleteSong(songId);
      navigate("/songs");
    } catch (err) {
      setErrorMsg(`Delete failed: ${err instanceof Error ? err.message : err}`);
      setShowDelete(false);
    }
  };

  if (loading) return (
    <DetailSkeleton
      trackCount={2}
      metaBlock={
        <div className="mb-6 rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-3">
          <div className="h-4 w-16 animate-pulse rounded bg-gray-800" />
          <div className="h-12 w-full animate-pulse rounded bg-gray-800" />
        </div>
      }
    />
  );
  if (fetchError) return <FetchError error={fetchError} onRetry={loadSong} />;

  if (!song) return <p className="text-red-400">Song not found.</p>;

  const activeTab = tab ?? (song.sheet || takes.length === 0 ? "chart" : "takes");
  const multiGroup = user != null && user.groups.length > 1;
  const meta = [
    `${takes.length} take${takes.length !== 1 ? "s" : ""}`,
    song.last_date ? `last played ${formatShortDate(song.last_date)}` : null,
    multiGroup ? song.group_name : null,
  ].filter(Boolean).join(" · ");
  const latestPlaying = takes.length > 0 && player.isCurrent(`track:${takes[0].id}`) && player.playing;
  const currentSheet = editingSheet ? sheetInput : song.sheet;

  const sheetActions: SheetSection[] = [];
  if (canEdit(user)) {
    sheetActions.push({ actions: [
      { label: song.sheet ? "Edit chart" : "Add chart", onClick: () => { setTab("chart"); setEditingSheet(true); } },
      {
        label: "Fetch lyrics",
        hint: song.artist ? "lrclib.net" : "needs artist",
        disabled: !song.artist || fetchingLyrics,
        onClick: () => { setTab("chart"); handleFetchLyrics(); },
      },
      ...(currentSheet && !isChordPro(currentSheet)
        ? [{ label: "Convert to ChordPro", onClick: handleConvertToChordPro }]
        : []),
      { label: "Rename", onClick: () => setEditingName(true) },
      { label: song.artist ? "Change artist" : "Add artist", onClick: () => setEditingArtist(true) },
      { label: song.notes ? "Edit notes" : "Add notes", onClick: () => { setTab("chart"); setEditingNotesField(true); } },
    ] });
  }
  if (canAdmin(user)) {
    sheetActions.push({ title: "Manage", actions: [
      ...(multiGroup
        ? user!.groups.filter((g) => g.id !== song.group_id).map((g) => ({
            label: `Move to ${g.name}`,
            onClick: () => setPendingGroupId(g.id),
          }))
        : []),
      { label: "Delete song", destructive: true, onClick: () => setShowDelete(true) },
    ] });
  }

  return (
    <div>
      <div className="relative isolate -mx-4 -mt-3 px-4 pt-3 sm:mx-0 sm:px-0">
        <HeroBackdrop seed={`song-${song.id}`} />
        <Link to="/songs" className="-ml-1 inline-flex items-center text-[15px] font-medium text-white/80 active:opacity-70">
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg>
          Songs
        </Link>

        <div className="mt-3 flex animate-rise flex-col items-center text-center">
          <Artwork seed={`song-${song.id}`} name={song.name} size="lg" className="shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]" />
          {editingName && canEdit(user) ? (
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveName();
                if (e.key === "Escape") { setEditingName(false); setNameInput(song.name); }
              }}
              onBlur={handleSaveName}
              className="font-display mt-6 w-full max-w-sm rounded-xl bg-white/[0.08] px-3 py-1 text-center text-[34px] text-white outline-none focus:ring-2 focus:ring-accent-500/60"
            />
          ) : (
            <h1 className="font-display mt-6 text-[42px] leading-[1.02] text-white">{song.name}</h1>
          )}
          {editingArtist && canEdit(user) ? (
            <input
              autoFocus
              value={artistInput}
              onChange={(e) => setArtistInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveArtist();
                if (e.key === "Escape") { setEditingArtist(false); setArtistInput(song.artist ?? ""); }
              }}
              onBlur={handleSaveArtist}
              placeholder="Artist"
              className="mt-2 w-full max-w-xs rounded-xl bg-white/[0.08] px-3 py-1.5 text-center text-base text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent-500/60"
            />
          ) : (
            <>
              {song.artist && <p className="mt-1.5 text-[17px] font-medium text-gray-200">{song.artist}</p>}
              <p className="mt-1 text-sm text-gray-400">{meta}</p>
            </>
          )}

          <div className="mt-6 flex w-full max-w-sm items-center gap-3">
            {takes.length > 0 && (
              <button
                onClick={() => {
                  const t = takes[0];
                  player.play({
                    key: `track:${t.id}`,
                    src: api.trackAudioUrl(t.id),
                    title: song.name,
                    subtitle: `${t.session_name || "Session"} · ${formatShortDate(t.session_date)}`,
                    durationSec: t.duration_sec,
                    trackId: t.id,
                    artSeed: `song-${song.id}`,
                  });
                }}
                className="btn-primary h-12 flex-1 text-[15px]"
              >
                {latestPlaying ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
                {latestPlaying ? "Pause" : "Latest take"}
              </button>
            )}
            {song.sheet && (
              <Link to={`/songs/${songId}/perform`} className={`${takes.length > 0 ? "btn-glass" : "btn-primary"} h-12 flex-1 text-[15px]`}>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" /></svg>
                Perform
              </Link>
            )}
            {sheetActions.length > 0 && (
              <button onClick={() => setActionsOpen(true)} aria-label="Song actions" className="btn-glass h-12 w-12 shrink-0">
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path d="M3 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM8.5 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM15.5 8.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-20 -mx-4 mt-7 px-4 py-2 glass sm:top-[57px] sm:mx-0 sm:rounded-xl sm:px-1">
        <div className="flex rounded-full bg-white/[0.06] p-1 text-sm font-semibold">
          {(["chart", "takes"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-full py-2 transition ${activeTab === t ? "bg-white text-gray-950 shadow" : "text-gray-400"}`}
            >
              {t === "chart" ? "Chart" : `Takes${takes.length ? ` · ${takes.length}` : ""}`}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "chart" ? (
        <div className="mt-6 animate-rise">
          {editingSheet && canEdit(user) ? (
            <div>
              <textarea
                autoFocus
                value={sheetInput}
                onChange={(e) => setSheetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.metaKey) { e.preventDefault(); handleSaveSheet(); }
                  if (e.key === "Escape") handleCancelSheet();
                }}
                rows={16}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="w-full rounded-xl bg-white/[0.06] px-3 py-2 font-mono text-[15px] leading-relaxed text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent-500/60"
                placeholder={"Paste chords and lyrics here.\n\n[Verse 1]\nG           C\nHeading down south to the land of the pines"}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onMouseDown={(e) => { e.preventDefault(); handleSaveSheet(); }}
                  className="btn-primary h-10 px-5 text-sm"
                >
                  Save
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); handleCancelSheet(); }}
                  className="rounded-full px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : song.sheet ? (
            <div className="text-[18px] leading-relaxed">
              <ChordSheet text={song.sheet} wrapText />
            </div>
          ) : (
            <div className="flex flex-col items-center rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
              <p className="text-[15px] text-gray-300">No chart yet.</p>
              {canEdit(user) && (
                <>
                  <p className="mt-1 max-w-xs text-sm text-gray-500">Copy chords and lyrics from any chord site and paste them in.</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <button
                      onClick={() => setEditingSheet(true)}
                      className="btn-primary h-11 px-5 text-sm"
                    >
                      Paste chart
                    </button>
                    {song.artist && (
                      <button
                        onClick={handleFetchLyrics}
                        disabled={fetchingLyrics}
                        className="btn-glass h-11 px-5 text-sm disabled:opacity-50"
                      >
                        {fetchingLyrics ? "Fetching…" : "Fetch lyrics"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {(song.notes || editingNotesField) && (
            <div className="mt-8 border-t border-white/[0.07] pt-4">
              <EditableField
                label="Notes"
                value={song.notes ?? ""}
                placeholder="Add notes"
                readOnly={!canEdit(user)}
                onSave={(v) => { setEditingNotesField(false); return handleSaveField("notes", v); }}
              />
            </div>
          )}
        </div>
      ) : takes.length === 0 ? (
        <p className="mt-8 text-center text-gray-400">No recorded takes yet. Tag a track in a recording to add one.</p>
      ) : (
        <div className="mt-3">
          <ListRows>
            {takes.map((take) => (
              <TakeRow
                key={take.id}
                take={take}
                songId={song.id}
                songName={song.name}
                onUpdate={refresh}
                readOnly={!canEdit(user)}
                onError={setErrorMsg}
              />
            ))}
          </ListRows>
        </div>
      )}

      <ActionSheet
        open={actionsOpen}
        title={song.name}
        subtitle={song.artist || undefined}
        sections={sheetActions}
        onClose={() => setActionsOpen(false)}
      />
      <Modal
        open={showFetchConfirm}
        title="Append lyrics"
        message="Append fetched lyrics to existing sheet content?"
        confirmLabel="Append"
        onConfirm={doFetchLyrics}
        onCancel={() => setShowFetchConfirm(false)}
      />
      <Modal
        open={pendingGroupId !== null}
        title="Move song"
        message={`Move "${song?.name}" to "${user?.groups.find(g => g.id === pendingGroupId)?.name}"? Tracks in existing sessions will stay in their current group.`}
        confirmLabel="Move"
        onConfirm={async () => {
          const gid = pendingGroupId!;
          setPendingGroupId(null);
          try {
            const updated = await api.updateSongGroup(songId, gid);
            setSong(updated);
          } catch (err) {
            setErrorMsg(`Move failed: ${err instanceof Error ? err.message : err}`);
          }
        }}
        onCancel={() => setPendingGroupId(null)}
      />
      <Modal
        open={showDelete}
        title="Delete song"
        message={`Delete "${song?.name}"? ${takes.length > 0 ? `${takes.length} track${takes.length !== 1 ? "s" : ""} will be untagged.` : "This song has no tracks."}`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
      />
      {errorMsg && (
        <Toast message={errorMsg} variant="error" onClose={() => setErrorMsg(null)} />
      )}
    </div>
  );
}
