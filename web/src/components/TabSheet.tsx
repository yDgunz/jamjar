import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import ChordSheet from "./ChordSheet";
import { parseTab, symbolsUsed, wrapStaff } from "../utils/tabParser";
import type { TabBlock } from "../utils/tabParser";

/**
 * A guitar tab, drawn for reading while you play: each staff is one block with
 * its chord names lined up over it, fret numbers stand out from the string
 * lines, and a staff too wide for the screen wraps at a bar line instead of
 * scrolling sideways. Sections get a heading and, when there are several, a
 * row of chips to jump between them.
 */
export default function TabSheet({ text, source }: { text: string; source?: string }) {
  const blocks = useMemo(() => parseTab(text), [text]);
  const symbols = useMemo(() => symbolsUsed(blocks), [blocks]);
  const rootRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [cols, setCols] = useState(0);

  // How many monospace characters fit across a staff block
  useLayoutEffect(() => {
    const root = rootRef.current;
    const probe = probeRef.current;
    if (!root || !probe) return;
    const measure = () => {
      const ch = probe.getBoundingClientRect().width / 20;
      if (ch > 0) setCols(Math.floor((root.clientWidth - STAFF_PAD_PX) / ch));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const sections = blocks.flatMap((b, i) => (b.type === "section" ? [{ i, title: b.title }] : []));
  const jump = (i: number) =>
    rootRef.current?.querySelector(`[data-tab-section="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div ref={rootRef} className="relative text-[15px] text-gray-300">
      <span ref={probeRef} aria-hidden className={`${STAFF_FONT} invisible absolute whitespace-pre`}>
        {"0".repeat(20)}
      </span>

      {sections.length >= 3 && (
        <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" style={{ scrollbarWidth: "none" }}>
          {sections.map((s) => (
            <button
              key={s.i}
              onClick={() => jump(s.i)}
              className="shrink-0 rounded-full bg-white/[0.07] px-3 py-1 text-[13px] font-medium text-gray-300 transition hover:bg-white/[0.12] active:bg-white/20"
            >
              {s.title}
            </button>
          ))}
        </div>
      )}

      {blocks.map((b, i) => (
        <Block key={i} block={b} index={i} cols={cols} first={i === 0} />
      ))}

      {(symbols.length > 0 || source) && (
        <div className="mt-8 border-t border-white/[0.07] pt-3 text-[13px] text-gray-500">
          {symbols.length > 0 && (
            <details>
              <summary className="cursor-pointer select-none text-gray-400 hover:text-gray-200">Symbols</summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr_auto_1fr]">
                {symbols.map(([sym, name]) => (
                  <Fragment key={sym}>
                    <dt className="font-mono font-semibold text-accent-400">{sym}</dt>
                    <dd className="text-gray-400">{name}</dd>
                  </Fragment>
                ))}
              </dl>
            </details>
          )}
          {source && <p className={symbols.length > 0 ? "mt-2" : ""}>Source: <TabSource source={source} /></p>}
        </div>
      )}
    </div>
  );
}

const STAFF_FONT = "font-mono text-[13px] leading-[1.3] sm:text-[14px]";
/** Horizontal padding of a staff block (px-2.5 on both sides) */
const STAFF_PAD_PX = 20;

function Block({ block, index, cols, first }: { block: TabBlock; index: number; cols: number; first: boolean }) {
  switch (block.type) {
    case "section":
      return (
        <h3
          data-tab-section={index}
          className={`${first ? "" : "mt-7"} mb-2 flex scroll-mt-24 items-center gap-3 text-[13px] font-semibold uppercase tracking-wider text-accent-400`}
        >
          {block.title}
          <span className="h-px flex-1 bg-white/10" />
        </h3>
      );
    case "staff":
      return <Staff block={block} cols={cols} />;
    case "chords":
      return <div className="my-1 whitespace-pre-wrap font-mono text-[14px] font-semibold text-accent-400">{block.text}</div>;
    case "note":
      return <p className={`${block.tight ? "mb-1 mt-3" : "my-2"} text-[14px] leading-snug text-gray-400`}>{block.text}</p>;
    case "sheet":
      return (
        <div className="my-3 text-[15px]">
          <ChordSheet text={block.text} wrapText />
        </div>
      );
  }
}

function Staff({ block, cols }: { block: Extract<TabBlock, { type: "staff" }>; cols: number }) {
  // Until the width is known, don't wrap (the block scrolls sideways)
  const chunks = useMemo(() => (cols > 0 ? wrapStaff(block, cols) : [block]), [block, cols]);
  return (
    <div className={`${STAFF_FONT} my-2 overflow-x-auto rounded-lg bg-white/[0.04] px-2.5 py-2`}>
      {chunks.map((c, k) => (
        <pre key={k} className={`${k > 0 ? "mt-3" : ""} whitespace-pre font-mono`}>
          {c.labels.map((l, j) => (
            <div key={`l${j}`} className="font-semibold text-accent-400">{l || " "}</div>
          ))}
          {c.lines.map((l, j) => (
            <StaffLine key={j} line={l} />
          ))}
          {c.beats.map((l, j) => (
            <div key={`b${j}`} className="text-gray-500">{l}</div>
          ))}
        </pre>
      ))}
    </div>
  );
}

/** One string: its name and the dashes recede, the notes stand out. */
function StaffLine({ line }: { line: string }) {
  const at = line.search(/[|:]/) + 1;
  const runs = line.slice(at).match(/-+|\|+|\d+|\s+|[^-|\d\s]+/g) ?? [];
  return (
    <div>
      <span className="text-gray-500">{line.slice(0, at)}</span>
      {runs.map((r, i) =>
        r[0] === "-" ? <span key={i} className="text-gray-600">{r}</span>
        : r[0] === "|" ? <span key={i} className="text-gray-500">{r}</span>
        : /\d/.test(r[0]) ? <span key={i} className="font-semibold text-white">{r}</span>
        : <span key={i} className="text-accent-400">{r}</span>,
      )}
    </div>
  );
}

/** Where the tab came from: a link when it is one, otherwise the text as written. */
function TabSource({ source }: { source: string }) {
  if (/^https?:\/\//i.test(source)) {
    let host = source;
    try { host = new URL(source).hostname.replace(/^(www|tabs)\./, ""); } catch { /* keep the text */ }
    return <a href={source} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 hover:text-gray-300">{host}</a>;
  }
  return <>{source.replace(/,\s*/g, " · ")}</>;
}
