import { useEffect, useState } from "react";
import { api } from "../api";
import type { Song } from "../api";
import type { TabFlagReason } from "../api";
import TabSheet from "./TabSheet";

/** A song's guitar tab (intros, riffs, solos): kept apart from the chords/lyrics chart. */
export default function SongTab({
  song,
  canEdit,
  editing,
  onEditingChange,
  onSaved,
}: {
  song: Song;
  canEdit: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSaved: (song: Song) => void;
}) {
  const [draft, setDraft] = useState(song.tab ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onSaved(await api.setSongTab(song.id, draft));
      onEditingChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (editing && canEdit) {
    return (
      <div className="mt-5">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) { e.preventDefault(); save(); }
            if (e.key === "Escape") onEditingChange(false);
          }}
          rows={16}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="w-full rounded-xl bg-white/[0.06] px-3 py-2 font-mono text-[14px] leading-snug text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent-500/60"
          placeholder={"Paste a tab here.\n\n[Intro]\ne|-------0-------|\nB|-----1---1-----|\nG|---2-------2---|"}
        />
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-full bg-accent-600 px-5 py-2 text-sm font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => { setDraft(song.tab ?? ""); onEditingChange(false); }}
            className="rounded-full px-4 py-2 text-sm text-gray-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5">
      {song.tab_flag === "messy" && (
        <p className="mb-4 rounded-lg bg-white/[0.05] px-3 py-2 text-[13px] text-gray-400">
          Marked as messy. It gets a closer cleanup with the next library update.
        </p>
      )}
      <TabSheet text={song.tab ?? ""} source={song.tab_source} />
    </div>
  );
}

const FLAG_REASONS: [TabFlagReason, string, string][] = [
  ["messy", "Messy or cluttered", "Tidied in place"],
  ["wrong_song", "Wrong song or version", "Replaced overnight"],
  ["inaccurate", "Doesn't sound right", "Replaced overnight"],
  ["other", "Something else", "Replaced overnight"],
];

/** Asked when marking a tab as bad: what's wrong decides what happens to it. */
export function FlagTabDialog({
  open,
  onFlag,
  onCancel,
}: {
  open: boolean;
  onFlag: (reason: TabFlagReason) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative mx-4 w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 px-6 py-5 shadow-xl">
        <h3 className="text-sm font-semibold text-white">Mark this tab as bad</h3>
        <p className="mt-1 text-xs text-gray-500">
          What's wrong with it? A messy tab stays while it's tidied; any other is removed now and a different version is looked for overnight.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {FLAG_REASONS.map(([reason, label, effect]) => (
            <button
              key={reason}
              onClick={() => onFlag(reason)}
              className="flex items-baseline justify-between gap-3 rounded-lg bg-white/[0.08] px-3 py-2 text-left text-sm text-gray-200 transition hover:bg-white/[0.14] active:bg-white/20"
            >
              {label}
              <span className="shrink-0 text-xs text-gray-500">{effect}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
