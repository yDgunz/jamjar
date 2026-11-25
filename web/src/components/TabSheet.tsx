import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import ChordSheet from "./ChordSheet";
import { layoutStaffLine, parseTab, symbolsUsed, wrapStaff } from "../utils/tabParser";
import type { StaffMark, TabBlock } from "../utils/tabParser";

/**
 * A guitar tab, drawn for reading while you play: each staff is one block with
 * its chord names lined up over it, the strings are drawn as thin lines with
 * the fret numbers sitting on them and techniques as marks (see `StaffRows`),
 * and a staff too wide for the screen wraps at a bar line instead of
 * scrolling sideways. Sections get a heading and, when there are several, a
 * row of chips to jump between them.
 */
export default function TabSheet({ text, source }: { text: string; source?: string }) {
  const blocks = useMemo(() => parseTab(text), [text]);
  const symbols = useMemo(() => symbolsUsed(blocks), [blocks]);
  const rootRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [grid, setGrid] = useState<Grid>({ cols: 0, ch: 0, font: 0 });
  const cols = grid.cols;

  // How many monospace characters fit across a staff block
  useLayoutEffect(() => {
    const root = rootRef.current;
    const probe = probeRef.current;
    if (!root || !probe) return;
    const measure = () => {
      const ch = probe.getBoundingClientRect().width / 20;
      if (ch <= 0) return;
      const next = {
        cols: Math.floor((root.clientWidth - STAFF_PAD_PX) / ch),
        ch,
        font: parseFloat(getComputedStyle(probe).fontSize) || 13,
      };
      setGrid((g) => (g.cols === next.cols && g.ch === next.ch && g.font === next.font ? g : next));
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
        <Block key={i} block={b} index={i} grid={grid} first={i === 0} />
      ))}

      {(symbols.length > 0 || source) && (
        <div className="mt-8 border-t border-white/[0.07] pt-3 text-[13px] text-gray-500">
          {symbols.length > 0 && (
            <details>
              <summary className="cursor-pointer select-none text-gray-400 hover:text-gray-200">Symbols</summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr_auto_1fr]">
                {symbols.map(([sym, name]) => (
                  <Fragment key={sym}>
                    <dt className="font-mono font-semibold text-accent-400">{SYMBOL_DRAWN[sym] ?? sym}</dt>
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

/** The width of the staff blocks in characters, and the size of one character */
interface Grid {
  cols: number;
  ch: number;
  font: number;
}

/** How the staff draws the symbols a tab is typed with, for the Symbols list */
const SYMBOL_DRAWN: Record<string, string> = { h: "⌒", p: "⌒", b: "⤴", r: "⤵", s: "/", x: "×" };

function Block({ block, index, grid, first }: { block: TabBlock; index: number; grid: Grid; first: boolean }) {
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
      return <Staff block={block} grid={grid} />;
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

function Staff({ block, grid }: { block: Extract<TabBlock, { type: "staff" }>; grid: Grid }) {
  // Until the width is known, don't wrap (the block scrolls sideways)
  const chunks = useMemo(() => (grid.cols > 0 ? wrapStaff(block, grid.cols) : [block]), [block, grid.cols]);
  return (
    <div className={`${STAFF_FONT} my-2 overflow-x-auto rounded-lg bg-white/[0.04] px-2.5 py-2`}>
      {chunks.map((c, k) => (
        <pre key={k} className={`${k > 0 ? "mt-3" : ""} whitespace-pre font-mono`}>
          {c.labels.map((l, j) => (
            <div key={`l${j}`} className="font-semibold text-accent-400">{l || " "}</div>
          ))}
          {grid.ch > 0 ? <StaffRows lines={c.lines} grid={grid} /> : c.lines.map((l, j) => <StaffLine key={j} line={l} />)}
          {c.beats.map((l, j) => (
            <div key={`b${j}`} className="text-gray-500">{l}</div>
          ))}
        </pre>
      ))}
    </div>
  );
}

/**
 * The strings of one staff, drawn: a thin line per string that stops either
 * side of each fret number, bar lines joined from the top string to the
 * bottom one, and techniques as marks. Everything sits on the same character
 * grid as the text around it, so chord names and beat counts still line up.
 */
function StaffRows({ lines, grid }: { lines: string[]; grid: Grid }) {
  const { ch, font } = grid;
  const rowH = Math.round(font * 1.25);
  const rows = useMemo(() => lines.map(layoutStaffLine), [lines]);
  const width = Math.max(...lines.map((l) => l.length)) * ch;
  const last = rows.length - 1;
  return (
    <svg
      role="img"
      aria-label={lines.join("\n")}
      width={width}
      height={rowH * rows.length}
      className="block font-mono"
      fontSize={font}
      fill="currentColor"
      stroke="none"
    >
      {rows.map((row, r) => {
        const y = rowH * (r + 0.5);
        const base = y + font * 0.36;
        return (
          <g key={r}>
            <text x={0} y={base} className="text-gray-500" xmlSpace="preserve">{row.name}</text>
            {row.marks.map((m, i) => (
              <Mark key={i} m={m} y={y} base={base} ch={ch} top={r === 0 ? y : y - rowH / 2} bottom={r === last ? y : y + rowH / 2} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function Mark({ m, y, base, ch, top, bottom }: { m: StaffMark; y: number; base: number; ch: number; top: number; bottom: number }) {
  const accent = { className: "text-accent-400", stroke: "currentColor", fill: "none", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (m.kind) {
    case "line":
      return <line x1={m.from * ch} x2={m.to * ch} y1={y} y2={y} className="text-gray-600" stroke="currentColor" strokeWidth={1} />;
    case "bar": {
      const x = (m.col + 0.5) * ch;
      return <line x1={x} x2={x} y1={top} y2={bottom} className="text-gray-500" stroke="currentColor" strokeWidth={1} />;
    }
    case "fret":
      return (
        <text x={m.col * ch} y={base} fontWeight={600} className={m.target ? "text-accent-400" : "text-white"}>
          {m.text}
        </text>
      );
    case "slur": {
      const [x1, x2] = [m.from * ch, m.to * ch];
      const up = y - ch * 0.75;
      return <path d={`M${x1} ${up} Q${(x1 + x2) / 2} ${up - ch * 0.9} ${x2} ${up}`} {...accent} strokeWidth={1.25} />;
    }
    case "slide": {
      const [x1, x2] = [(m.col + 0.1) * ch, (m.col + 0.9) * ch];
      const d = ch * 0.5 * (m.up ? 1 : -1);
      return <line x1={x1} x2={x2} y1={y + d} y2={y - d} {...accent} />;
    }
    case "bend": {
      const [x1, x2] = [(m.col + 0.05) * ch, (m.col + 0.6) * ch];
      const [from, to] = m.release ? [y - ch * 0.7, y + ch * 0.35] : [y + ch * 0.35, y - ch * 0.7];
      const head = ch * 0.32 * (m.release ? -1 : 1);
      return (
        <path
          d={`M${x1} ${from} Q${x2} ${from} ${x2} ${to} M${x2 - Math.abs(head)} ${to + head} L${x2} ${to} L${x2 + Math.abs(head)} ${to + head}`}
          {...accent}
          strokeWidth={1.25}
        />
      );
    }
    case "vibrato": {
      let d = `M${m.from * ch} ${y}`;
      const half = ch / 2;
      for (let x = m.from * ch, k = 0; x < m.to * ch - 0.01; x += half, k++) {
        d += ` Q${x + half / 2} ${y + (k % 2 ? 1 : -1) * ch * 0.55} ${x + half} ${y}`;
      }
      return <path d={d} {...accent} strokeWidth={1.25} />;
    }
    case "mute": {
      const [x, d] = [(m.col + 0.5) * ch, ch * 0.33];
      return <path d={`M${x - d} ${y - d} L${x + d} ${y + d} M${x - d} ${y + d} L${x + d} ${y - d}`} {...accent} className="text-gray-200" />;
    }
    case "text":
      return <text x={m.col * ch} y={base} className="text-accent-400" xmlSpace="preserve">{m.text}</text>;
  }
}

/** One string as coloured text: what shows for a moment before the width is measured. */
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
