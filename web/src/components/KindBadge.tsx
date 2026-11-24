import { SESSION_KIND_LABEL } from "../api";
import type { SessionKind } from "../api";

const STYLE: Record<Exclude<SessionKind, "">, string> = {
  studio: "border-amber-400/40 bg-amber-400/15 text-amber-300",
  gig: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  demo: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  jam: "border-white/10 bg-white/[0.04] text-gray-400",
};

/** Small pill saying what a recording is (jam, gig, demo, studio). Nothing when unset. */
export default function KindBadge({ kind, className = "" }: { kind: SessionKind | undefined; className?: string }) {
  if (!kind) return null;
  return (
    <span className={`inline-block rounded-full border px-1.5 py-px align-middle text-[11px] font-medium uppercase leading-4 tracking-wide ${STYLE[kind]} ${className}`}>
      {SESSION_KIND_LABEL[kind]}
    </span>
  );
}
