import { useEffect, useState } from "react";
import type { SongLink, VideoFlagReason } from "../api";
import { hostname, LINK_KIND_LABEL, youTubeId, youTubeStart } from "../utils/youtube";

/**
 * Horizontal strip of reference videos for a song. Tapping a YouTube video
 * plays it inline (sticky, so the chart can be scrolled while it plays);
 * other links open in a new tab.
 */
export default function SongVideos({
  links,
  canEdit,
  onAdd,
  onRemove,
}: {
  links: SongLink[];
  canEdit: boolean;
  onAdd: () => void;
  onRemove: (link: SongLink) => void;
}) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const active = links.find((l) => l.id === activeId) ?? null;
  const activeYt = active ? youTubeId(active.url) : null;

  if (links.length === 0) {
    if (!canEdit) return null;
    return (
      <button
        onClick={onAdd}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full px-1 text-sm text-gray-400 transition hover:text-gray-200"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" /></svg>
        Add a how-to or backing track video
      </button>
    );
  }

  return (
    <div className="mt-5">
      {active && activeYt && (
        <div className="sticky top-[max(0.5rem,env(safe-area-inset-top))] z-20 mb-3 overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10">
          <div className="relative aspect-video">
            <iframe
              key={active.id}
              src={`https://www.youtube-nocookie.com/embed/${activeYt}?autoplay=1&playsinline=1&rel=0&start=${youTubeStart(active.url)}`}
              title={active.title || "Video"}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
          <div className="flex items-center gap-2 bg-gray-900 px-3 py-2">
            <span className="shrink-0 rounded-full bg-accent-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-400">
              {LINK_KIND_LABEL[active.kind]}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-gray-300">{active.title || active.url}</span>
            <button
              onClick={() => setActiveId(null)}
              className="shrink-0 rounded-full px-2 py-1 text-sm text-gray-400 active:bg-white/10"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" style={{ scrollbarWidth: "none" }}>
        {links.map((link) => {
          const yt = youTubeId(link.url);
          const isActive = link.id === activeId;
          const content = (
            <>
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-white/[0.06]">
                {yt ? (
                  <img
                    src={`https://i.ytimg.com/vi/${yt}/mqdefault.jpg`}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-gray-500">Open link ↗</div>
                )}
                <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  {LINK_KIND_LABEL[link.kind]}
                </span>
                {yt && (
                  <span className={`absolute inset-0 flex items-center justify-center ${isActive ? "bg-black/50" : ""}`}>
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white">
                      {isActive ? (
                        <span className="text-[10px] font-semibold">ON</span>
                      ) : (
                        <svg className="ml-0.5 h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" /></svg>
                      )}
                    </span>
                  </span>
                )}
              </div>
              <div className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-gray-300">
                {link.title || hostname(link.url)}
              </div>
            </>
          );
          return (
            <div key={link.id} className="relative w-44 shrink-0">
              {yt ? (
                <button onClick={() => setActiveId(isActive ? null : link.id)} className="block w-full text-left active:opacity-80">
                  {content}
                </button>
              ) : (
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="block active:opacity-80">
                  {content}
                </a>
              )}
              {canEdit && (
                <button
                  onClick={() => onRemove(link)}
                  aria-label={`Remove ${link.title || "video"}`}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-gray-300 active:bg-black"
                >
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                </button>
              )}
            </div>
          );
        })}
        {canEdit && (
          <button
            onClick={onAdd}
            className="flex w-44 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 text-sm text-gray-400 active:bg-white/5"
            style={{ aspectRatio: "16 / 9" }}
          >
            <span className="text-xl leading-none">+</span>
            Add video
          </button>
        )}
      </div>
    </div>
  );
}

const FLAG_REASONS: [VideoFlagReason, string][] = [
  ["wrong_song", "Wrong song or version"],
  ["wrong_instrument", "Wrong instrument"],
  ["poor_quality", "Poor quality"],
  ["unavailable", "Won't play"],
  ["other", "Something else"],
];

/**
 * Asked when removing a video: say what's wrong with it, so the nightly
 * routine finds a better one, or just remove it.
 */
export function RemoveVideoDialog({
  link,
  onFlag,
  onRemove,
  onCancel,
}: {
  link: SongLink | null;
  onFlag: (link: SongLink, reason: VideoFlagReason) => void;
  onRemove: (link: SongLink) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!link) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [link, onCancel]);

  if (!link) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative mx-4 w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 px-6 py-5 shadow-xl">
        <h3 className="text-sm font-semibold text-white">Remove video</h3>
        <p className="mt-2 line-clamp-2 text-sm text-gray-400">{link.title || link.url}</p>
        <p className="mt-4 text-sm text-gray-300">Replace it with a better one</p>
        <p className="mt-0.5 text-xs text-gray-500">
          It's removed now and a replacement is found overnight. What's wrong with it?
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {FLAG_REASONS.map(([reason, label]) => (
            <button
              key={reason}
              onClick={() => onFlag(link, reason)}
              className="rounded-full bg-white/[0.08] px-3 py-1.5 text-sm text-gray-200 transition hover:bg-white/[0.14] active:bg-white/20"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={() => onRemove(link)}
            className="rounded px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/10"
          >
            Just remove it
          </button>
        </div>
      </div>
    </div>
  );
}
