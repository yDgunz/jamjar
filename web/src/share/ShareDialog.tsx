import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { ShareKind, ShareLink } from "../api";
import { describeExpiry, expiryChoices } from "./expiry";

/** What someone opening the link gets, per kind. */
const SHOWS: Record<ShareKind, string> = {
  track: "Anyone with the link can listen to and download this take, without logging in.",
  session: "Anyone with the link can listen to and download every track of this recording, without logging in.",
  setlist: "Anyone with the link can see this setlist's songs and their charts, without logging in. Recordings and notes stay private.",
  song: "Anyone with the link can see this song's chart, tab, history and videos, without logging in. Recordings and notes stay private.",
};

const NOUN: Record<ShareKind, string> = {
  track: "take",
  session: "recording",
  setlist: "setlist",
  song: "song",
};

export function fullShareUrl(link: ShareLink) {
  return `${window.location.origin}${link.url}`;
}

/**
 * Create, copy, re-time or revoke the public link for one track, recording,
 * setlist or song.
 */
export default function ShareDialog({
  open,
  kind,
  id,
  title,
  onClose,
}: {
  open: boolean;
  kind: ShareKind;
  id: number;
  title: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [defaultDays, setDefaultDays] = useState<number | null>(30);
  const [days, setDays] = useState<number | null>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setCopied(false);
    api.lookupShare(kind, id).then(
      (r) => {
        if (cancelled) return;
        setLink(r.link);
        setDefaultDays(r.default_expiry_days);
        setDays(r.default_expiry_days);
        setLoading(false);
      },
      (e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
    return () => { cancelled = true; };
  }, [open, kind, id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const live = link && !link.expired ? link : null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const create = () => run(async () => setLink(await api.createShare(kind, id, days)));
  const changeExpiry = (d: number | null) =>
    live && run(async () => setLink(await api.setShareExpiry(live.id, d)));
  const revoke = () =>
    live && run(async () => {
      await api.revokeShare(live.id);
      setLink(null);
      setDays(defaultDays);
    });

  const copy = async () => {
    if (!live) return;
    try {
      await navigator.clipboard.writeText(fullShareUrl(live));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the link and copy it by hand");
    }
  };
  const shareSheet = async () => {
    if (!live) return;
    try {
      await navigator.share({ title, url: fullShareUrl(live) });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) copy();
    }
  };

  const choices = expiryChoices(defaultDays);
  const selectClass =
    "rounded-lg bg-white/[0.08] px-3 py-2 text-base text-white outline-none focus:ring-2 focus:ring-accent-500/60 disabled:opacity-50 sm:text-sm";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-label={`Share ${NOUN[kind]}`}
        className="relative w-full rounded-t-2xl bg-gray-900 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 shadow-2xl sm:max-w-md sm:rounded-2xl sm:pb-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Share {NOUN[kind]}</div>
            <div className="truncate text-base font-semibold text-white">{title}</div>
          </div>
          <button onClick={onClose} className="-mr-1 rounded-full p-1 text-gray-400 hover:bg-white/10 hover:text-white" aria-label="Close">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
          </button>
        </div>
        <p className="mt-3 text-sm text-gray-400">{SHOWS[kind]}</p>

        {loading ? (
          <div className="mt-4 h-20 animate-pulse rounded-xl bg-white/[0.04]" />
        ) : live ? (
          <div className="mt-4 space-y-3">
            <input
              readOnly
              value={fullShareUrl(live)}
              onFocus={(e) => e.target.select()}
              className="w-full rounded-lg bg-white/[0.06] px-3 py-2 font-mono text-sm text-gray-200 outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={copy}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${copied ? "bg-accent-700 text-white" : "bg-accent-600 text-white hover:bg-accent-500"}`}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              {typeof navigator.share === "function" && (
                <button onClick={shareSheet} className="flex-1 rounded-full bg-white/[0.08] px-4 py-2 text-sm font-semibold text-white hover:bg-white/[0.12]">
                  Share…
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-3">
              {live.can_manage ? (
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  {live.expires_at ? describeExpiry(live.expires_at, false) : "Never expires"}
                  <select
                    aria-label="Change expiry"
                    value=""
                    disabled={busy}
                    onChange={(e) => changeExpiry(e.target.value === "never" ? null : Number(e.target.value))}
                    className={`${selectClass} w-28`}
                  >
                    <option value="" disabled>Change…</option>
                    {choices.map((c) => (
                      <option key={c.label} value={c.days ?? "never"}>
                        {c.days === null ? "Never expire" : `${c.label} from now`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="text-sm text-gray-400">
                  {describeExpiry(live.expires_at, false)}
                  {live.created_by_name ? ` · shared by ${live.created_by_name}` : ""}
                </span>
              )}
              {live.can_manage && (
                <button onClick={revoke} disabled={busy} className="rounded-full px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-950/60 disabled:opacity-50">
                  Stop sharing
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {link?.expired && <p className="text-sm text-amber-400/90">The previous link expired. A new link will have a new address.</p>}
            <label className="flex items-center justify-between gap-3 text-sm text-gray-300">
              Link expires after
              <select
                value={days ?? "never"}
                onChange={(e) => setDays(e.target.value === "never" ? null : Number(e.target.value))}
                className={selectClass}
              >
                {choices.map((c) => (
                  <option key={c.label} value={c.days ?? "never"}>{c.days === null ? "Never" : c.label}</option>
                ))}
              </select>
            </label>
            <button
              onClick={create}
              disabled={busy}
              className="w-full rounded-full bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-500 disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create link"}
            </button>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
