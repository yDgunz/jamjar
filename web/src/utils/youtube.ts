/** Extract a YouTube video id from the common URL shapes, or null. */
export function youTubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  const valid = (id: string | null | undefined) => (id && /^[\w-]{6,}$/.test(id) ? id : null);
  if (host === "youtu.be") return valid(u.pathname.split("/")[1]);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") return valid(u.searchParams.get("v"));
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]+)/);
    if (m) return valid(m[1]);
  }
  return null;
}

/** Start offset in seconds from ?t= / ?start= (e.g. "90", "1m30s"). */
export function youTubeStart(url: string): number {
  try {
    const u = new URL(url.trim());
    const t = u.searchParams.get("t") ?? u.searchParams.get("start");
    if (!t) return 0;
    if (/^\d+$/.test(t)) return Number(t);
    const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
  } catch {
    return 0;
  }
}

export const LINK_KIND_LABEL = {
  lesson: "How-to",
  backing_track: "Backing track",
  other: "Video",
} as const;
