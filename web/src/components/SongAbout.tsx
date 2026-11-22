import { Fragment } from "react";
import type { SongBackground } from "../api";

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A song's short written history, with [n] markers rendered as source links. */
export default function SongAbout({ background }: { background: SongBackground }) {
  const parts = background.text.split(/\s*(\[\d+\])/);
  return (
    <div className="mt-5">
      <p className="text-[17px] leading-relaxed text-gray-100">
        {parts.map((part, i) => {
          const m = part.match(/^\[(\d+)\]$/);
          if (!m) return <Fragment key={i}>{part}</Fragment>;
          const n = Number(m[1]);
          const src = background.sources[n - 1];
          if (!src) return null;
          return (
            <a
              key={i}
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              title={src.title}
              className="ml-0.5 align-super text-[11px] font-semibold text-accent-400 hover:text-accent-300"
            >
              {n}
            </a>
          );
        })}
      </p>

      <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-gray-500">Sources</h3>
      <ol className="mt-2 space-y-1.5">
        {background.sources.map((src, i) => (
          <li key={src.url} className="flex gap-2 text-sm">
            <span className="w-4 shrink-0 text-right text-gray-500">{i + 1}</span>
            <a
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 text-gray-300 hover:text-white"
            >
              <span className="underline decoration-white/20 underline-offset-2">{src.title}</span>
              <span className="ml-1.5 text-gray-500">{hostname(src.url)}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
