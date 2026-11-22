import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { api, formatLongDate, formatShortDate, canEdit, canAdmin, recordSongActivity } from "../api";
import type { Song, SongLink, SongLinkKind, SongTrack } from "../api";
import ActionSheet, { MoreButton } from "../components/ActionSheet";
import type { SheetAction, SheetSection } from "../components/ActionSheet";
import ChordSheet from "../components/ChordSheet";
import { ListRows } from "../components/ListItemCard";
import EditableField from "../components/EditableField";
import FetchError from "../components/FetchError";
import FormModal from "../components/FormModal";
import SongVideos from "../components/SongVideos";
import Modal, { Toast } from "../components/Modal";
import { DetailSkeleton } from "../components/PageLoadingSkeleton";
import { useAuth } from "../context/AuthContext";
import { formatTime, PauseIcon, PlayIcon, usePlayer } from "../context/PlayerContext";
import { isChordPro, toChordPro } from "../utils/chordpro";
import { LINK_KIND_LABEL } from "../utils/youtube";


function TakeRow({ take, songName, onUpdate, readOnly, onError }: {
  take: SongTrack;
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
  const [bandsOpen, setBandsOpen] = useState(false);

  const [editingArtist, setEditingArtist] = useState(false);
  const [artistInput, setArtistInput] = useState("");
  const [fetchingLyrics, setFetchingLyrics] = useState(false);
  const [editingSheet, setEditingSheet] = useState(false);
  const [sheetInput, setSheetInput] = useState("");
  const [tab, setTab] = useState<"chart" | "takes" | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editingNotesField, setEditingNotesField] = useState(false);
  const [addingVideo, setAddingVideo] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoKind, setVideoKind] = useState<SongLinkKind>("lesson");
  const [videoTitle, setVideoTitle] = useState("");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [savingVideo, setSavingVideo] = useState(false);
  const [removingLink, setRemovingLink] = useState<SongLink | null>(null);

  const openAddVideo = () => {
    setVideoUrl("");
    setVideoTitle("");
    setVideoKind("lesson");
    setVideoError(null);
    setTab("chart");
    setAddingVideo(true);
  };

  const handleAddVideo = async () => {
    if (!videoUrl.trim()) return;
    setSavingVideo(true);
    setVideoError(null);
    try {
      setSong(await api.addSongLink(songId, videoUrl.trim(), videoKind, videoTitle.trim()));
      setAddingVideo(false);
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingVideo(false);
    }
  };

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
  useEffect(() => { recordSongActivity(songId, "opened"); }, [songId]);

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
  const songGroups = song.groups ?? [];
  const bandNames = songGroups.length ? songGroups.map((g) => g.name).join(", ") : song.group_name;
  const linkedIds = new Set(songGroups.map((g) => g.id));
  const toggleBand = async (groupId: number, linked: boolean) => {
    try {
      setSong(linked ? await api.unlinkSongGroup(songId, groupId) : await api.linkSongGroup(songId, groupId));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };
  const meta = [
    song.artist,
    `${takes.length} take${takes.length !== 1 ? "s" : ""}`,
    multiGroup ? bandNames : null,
  ].filter(Boolean).join(" · ");
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
      { label: "Add video", hint: "how-to, backing track", onClick: openAddVideo },
      { label: "Rename", onClick: () => setEditingName(true) },
      { label: song.artist ? "Change artist" : "Add artist", onClick: () => setEditingArtist(true) },
      { label: song.notes ? "Edit notes" : "Add notes", onClick: () => { setTab("chart"); setEditingNotesField(true); } },
    ] });
    if (multiGroup) {
      sheetActions.push({
        actions: [{ label: "Bands…", hint: bandNames, onClick: () => setBandsOpen(true) }],
      });
    }
  }
  if (canAdmin(user)) {
    sheetActions.push({ title: "Manage", actions: [
      { label: "Delete song", destructive: true, onClick: () => setShowDelete(true) },
    ] });
  }

  return (
    <div>
      <Link to="/songs" className="-ml-1 inline-flex items-center text-[15px] text-accent-400 active:opacity-70">
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg>
        Songs
      </Link>

      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
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
              className="w-full rounded-lg bg-white/[0.08] px-2 py-1 text-[26px] font-bold text-white outline-none focus:ring-2 focus:ring-accent-500/60"
            />
          ) : (
            <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white">{song.name}</h1>
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
              className="mt-1 w-full rounded-lg bg-white/[0.08] px-2 py-1 text-base text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent-500/60"
            />
          ) : (
            <p className="mt-1 text-[15px] text-gray-400">{meta}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className="flex flex-1 rounded-lg bg-white/[0.08] p-0.5 text-sm font-medium">
          {(["chart", "takes"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md py-1.5 transition ${activeTab === t ? "bg-gray-600 text-white shadow" : "text-gray-400"}`}
            >
              {t === "chart" ? "Chart" : `Takes${takes.length ? ` (${takes.length})` : ""}`}
            </button>
          ))}
        </div>
        {sheetActions.length > 0 && (
          <button
            onClick={() => setActionsOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-2 text-sm font-medium text-gray-200 transition hover:bg-white/[0.14] active:bg-white/[0.14]"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" /><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" /></svg>
            Edit
          </button>
        )}
        {song.sheet && (
          <Link
            to={`/songs/${songId}/perform`}
            className="shrink-0 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-500 active:bg-accent-700"
          >
            Perform
          </Link>
        )}
      </div>

      {activeTab === "chart" ? (
        <div className="mt-5">
          <SongVideos
            links={song.links ?? []}
            canEdit={canEdit(user) === true}
            onAdd={openAddVideo}
            onRemove={setRemovingLink}
          />
          <div className={(song.links ?? []).length > 0 || canEdit(user) ? "mt-6" : ""} />
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
                  className="rounded-full bg-accent-600 px-5 py-2 text-sm font-semibold text-white hover:bg-accent-500"
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
            <div className="text-[17px]">
              <ChordSheet text={song.sheet} wrapText />
            </div>
          ) : (
            <div className="flex flex-col items-center rounded-xl bg-white/[0.04] px-6 py-10 text-center">
              <p className="text-[15px] text-gray-300">No chart yet.</p>
              {canEdit(user) && (
                <>
                  <p className="mt-1 max-w-xs text-sm text-gray-500">Copy chords and lyrics from any chord site and paste them in.</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <button
                      onClick={() => setEditingSheet(true)}
                      className="rounded-full bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-500"
                    >
                      Paste chart
                    </button>
                    {song.artist && (
                      <button
                        onClick={handleFetchLyrics}
                        disabled={fetchingLyrics}
                        className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-medium text-gray-200 disabled:opacity-50"
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

          {songGroups.filter((g) => g.notes || (multiGroup && canEdit(user))).map((g) => (
            <div key={g.id} className="mt-6 border-t border-white/[0.07] pt-4">
              <EditableField
                label={`${g.name} notes`}
                value={g.notes}
                placeholder={`How ${g.name} plays it — key, capo, arrangement…`}
                readOnly={!canEdit(user)}
                onSave={async (v) => {
                  try {
                    setSong(await api.setSongGroupNotes(songId, g.id, v));
                  } catch (err) {
                    setErrorMsg(`Save failed: ${err instanceof Error ? err.message : err}`);
                  }
                }}
              />
            </div>
          ))}
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
      <FormModal
        open={addingVideo}
        title="Add video"
        error={videoError}
        confirmLabel={savingVideo ? "Adding…" : "Add"}
        confirmDisabled={!videoUrl.trim() || savingVideo}
        onConfirm={handleAddVideo}
        onCancel={() => setAddingVideo(false)}
      >
        <input
          autoFocus
          type="url"
          inputMode="url"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="Paste a YouTube link"
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
        />
        <div className="flex rounded-lg bg-white/[0.06] p-0.5 text-sm font-medium">
          {(["lesson", "backing_track"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setVideoKind(k)}
              className={`flex-1 rounded-md py-1.5 transition ${videoKind === k ? "bg-gray-600 text-white" : "text-gray-400"}`}
            >
              {LINK_KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <input
          value={videoTitle}
          onChange={(e) => setVideoTitle(e.target.value)}
          placeholder="Title (optional — filled in from YouTube)"
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
        />
      </FormModal>
      <Modal
        open={removingLink !== null}
        title="Remove video"
        message={`Remove "${removingLink?.title || removingLink?.url}" from ${song?.name}?`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={async () => {
          const link = removingLink!;
          setRemovingLink(null);
          try {
            setSong(await api.deleteSongLink(songId, link.id));
          } catch (err) {
            setErrorMsg(`Remove failed: ${err instanceof Error ? err.message : err}`);
          }
        }}
        onCancel={() => setRemovingLink(null)}
      />
      <Modal
        open={showFetchConfirm}
        title="Append lyrics"
        message="Append fetched lyrics to existing sheet content?"
        confirmLabel="Append"
        onConfirm={doFetchLyrics}
        onCancel={() => setShowFetchConfirm(false)}
      />
      <FormModal
        open={bandsOpen}
        title="Bands that play this song"
        confirmLabel="Done"
        onConfirm={() => setBandsOpen(false)}
        onCancel={() => setBandsOpen(false)}
      >
        <div className="-mx-1 space-y-0.5">
          {(user?.groups ?? []).map((g) => {
            const linked = linkedIds.has(g.id);
            const locked = linked && (songGroups.length <= 1 || !canAdmin(user));
            return (
              <label
                key={g.id}
                className={`flex items-center gap-3 rounded-lg px-2 py-2 ${locked ? "opacity-60" : "cursor-pointer hover:bg-white/5"}`}
              >
                <input
                  type="checkbox"
                  checked={linked}
                  disabled={locked}
                  onChange={() => toggleBand(g.id, linked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent-500 focus:ring-accent-500 focus:ring-offset-0"
                />
                <span className="text-sm text-gray-200">{g.name}</span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-gray-500">
          Charts and videos are shared by every band that plays the song.
          {!canAdmin(user) && " Removing a band needs an admin."}
        </p>
      </FormModal>
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
