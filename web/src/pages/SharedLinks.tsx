import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { api, ApiError, canAdmin, formatDate } from "../api";
import type { ShareKind, ShareLink } from "../api";
import PageHeader from "../components/PageHeader";
import FetchError from "../components/FetchError";
import { ListSkeleton } from "../components/PageLoadingSkeleton";
import Modal, { Toast } from "../components/Modal";
import { useAuth } from "../context/AuthContext";
import { describeExpiry, expiryChoices, fullShareUrl } from "../share/expiry";


const KIND_LABEL: Record<ShareKind, string> = {
  track: "Take",
  session: "Recording",
  setlist: "Setlist",
  song: "Song",
};

/** Every public link the caller can manage: their own, plus (admins) their bands'. */
export default function SharedLinks() {
  const { user } = useAuth();
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; variant: "error" | "success" } | null>(null);
  const [revoking, setRevoking] = useState<ShareLink | null>(null);
  const [showExpired, setShowExpired] = useState(false);

  const fetchLinks = useCallback(
    () => api.listShares().then(setLinks, (e) => setError(e instanceof Error ? e.message : String(e))),
    [],
  );
  useEffect(() => { fetchLinks(); }, [fetchLinks]);
  const retry = () => { setError(null); fetchLinks(); };

  const replace = (link: ShareLink) =>
    setLinks((prev) => prev?.map((l) => (l.id === link.id ? link : l)) ?? null);

  const changeExpiry = async (link: ShareLink, days: number | null) => {
    try {
      replace(await api.setShareExpiry(link.id, days));
      setToast({ message: days === null ? "Link never expires" : "Expiry updated", variant: "success" });
    } catch (e) {
      setToast({ message: e instanceof ApiError ? e.message : String(e), variant: "error" });
    }
  };

  const revoke = async () => {
    const link = revoking;
    setRevoking(null);
    if (!link) return;
    try {
      await api.revokeShare(link.id);
      setLinks((prev) => prev?.filter((l) => l.id !== link.id) ?? null);
      setToast({ message: "Link removed", variant: "success" });
    } catch (e) {
      setToast({ message: e instanceof ApiError ? e.message : String(e), variant: "error" });
    }
  };

  const copy = async (link: ShareLink) => {
    try {
      await navigator.clipboard.writeText(fullShareUrl(link));
      setToast({ message: "Link copied", variant: "success" });
    } catch {
      setToast({ message: "Couldn't copy the link", variant: "error" });
    }
  };

  if (error) return <div><PageHeader title="Shared links" /><FetchError error={error} onRetry={retry} /></div>;
  if (!links) return <ListSkeleton />;

  const active = links.filter((l) => !l.expired);
  const expired = links.filter((l) => l.expired);
  const isAdmin = canAdmin(user);
  // Default expiry isn't needed to change a link; offer the standard choices
  const choices = expiryChoices(30);

  const row = (link: ShareLink) => {
    const mine = link.created_by === user?.id;
    const meta = [
      KIND_LABEL[link.kind],
      link.subtitle && (link.kind === "session" || link.kind === "setlist") ? formatDate(link.subtitle) : link.subtitle,
      user && user.groups.length > 1 ? link.group_name : null,
      !mine && link.created_by_name ? `by ${link.created_by_name}` : null,
    ].filter(Boolean).join(" · ");
    return (
      <li key={link.id} className="py-3">
        {link.app_path ? (
          <Link to={link.app_path} className="block truncate text-[17px] text-white hover:text-accent-400 sm:text-base">
            {link.title || "Untitled"}
          </Link>
        ) : (
          <span className="block truncate text-[17px] text-white sm:text-base">{link.title || "Deleted"}</span>
        )}
        <div className="truncate text-sm text-gray-500">{meta}</div>
        <div className="mt-2 flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-sm ${link.expired ? "text-amber-400/90" : "text-gray-400"}`}>
            {describeExpiry(link.expires_at, link.expired)}
          </span>
          {!link.expired && (
            <button onClick={() => copy(link)} className="shrink-0 rounded-full bg-white/[0.08] px-3 py-1.5 text-sm font-medium text-gray-100 hover:bg-white/[0.14]">
              Copy
            </button>
          )}
          {link.can_manage && (
            <>
              <select
                aria-label={link.expired ? "Renew link" : "Change expiry"}
                value=""
                onChange={(e) => changeExpiry(link, e.target.value === "never" ? null : Number(e.target.value))}
                className="w-[6.5rem] shrink-0 rounded-full bg-white/[0.08] px-3 py-1.5 text-base font-medium text-gray-100 outline-none sm:text-sm"
              >
                <option value="" disabled>{link.expired ? "Renew…" : "Expiry…"}</option>
                {choices.map((c) => (
                  <option key={c.label} value={c.days ?? "never"}>
                    {c.days === null ? "Never expire" : `${c.label} from now`}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setRevoking(link)}
                className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-950/60"
              >
                {link.expired ? "Delete" : "Stop"}
              </button>
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <div>
      <PageHeader title="Shared links" />
      <p className="mb-4 text-sm text-gray-400">
        Public links {isAdmin ? "you or your bands made" : "you made"}. Anyone with one can open it without logging in
        until it expires or you stop sharing it. Share something from its menu on a recording, song or setlist.
      </p>
      {active.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">No active links.</p>
      ) : (
        <ul className="divide-y divide-white/[0.07]">{active.map(row)}</ul>
      )}
      {expired.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowExpired(!showExpired)} className="text-sm font-medium text-gray-400 hover:text-gray-200">
            {showExpired ? "Hide" : "Show"} expired ({expired.length})
          </button>
          {showExpired && <ul className="mt-2 divide-y divide-white/[0.07] opacity-80">{expired.map(row)}</ul>}
        </div>
      )}
      <Modal
        open={revoking !== null}
        title={revoking?.expired ? "Delete link" : "Stop sharing"}
        message={
          revoking?.expired
            ? `Remove the expired link to "${revoking?.title}" from this list?`
            : `The link to "${revoking?.title}" will stop working for everyone who has it.`
        }
        confirmLabel={revoking?.expired ? "Delete" : "Stop sharing"}
        variant="danger"
        onConfirm={revoke}
        onCancel={() => setRevoking(null)}
      />
      {toast && <Toast message={toast.message} variant={toast.variant} onClose={() => setToast(null)} />}
    </div>
  );
}
