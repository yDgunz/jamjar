import type { CSSProperties, ReactNode } from "react";
import { isChordToken, parseSheet } from "../utils/sheetParser";
import { isChordPro, parseChordProLine } from "../utils/chordpro";

/**
 * Perform mode's "notebook" look: the chart as if written by hand on ruled
 * paper. Lyrics are in ballpoint, chords in a bold red felt-tip.
 *
 * Every row is exactly one rule tall (see the .nb-* styles in index.css), so
 * the writing sits on the lines however it wraps.
 */

type Segment = { chord?: string; text?: string };
type Row =
  | { type: "empty" }
  | { type: "header"; text: string }
  | { type: "tab"; text: string }
  | { type: "chords"; text: string }
  | { type: "text"; text: string }
  | { type: "paired"; segments: Segment[] };

function toRows(text: string): Row[] {
  if (isChordPro(text)) {
    return text.split("\n").map((line): Row => {
      const parsed = parseChordProLine(line);
      if (parsed.type === "paired") return { type: "paired", segments: parsed.segments };
      return parsed;
    });
  }
  return parseSheet(text).map((line): Row => {
    switch (line.type) {
      case "paired":
        return { type: "paired", segments: line.segments.map((s) => ({ chord: s.chord, text: s.lyric })) };
      case "chords-only":
        return { type: "chords", text: line.text };
      default:
        return line;
    }
  });
}

/** Small stable pseudo-random number in [-1, 1] from a string. */
function wobble(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2001) / 1000 - 1;
}

/**
 * Nobody writes a word the same way twice: give each word a slight tilt and
 * drift off the line. Seeded by the word and its place, so it doesn't shimmer
 * between renders.
 */
function wobbleStyle(seed: string, tilt: number, drift: number): CSSProperties {
  const r = wobble(seed) * tilt;
  const y = wobble(seed + "y") * drift;
  return { transform: `translateY(${y.toFixed(3)}em) rotate(${r.toFixed(2)}deg)` };
}

function Chord({ name, seed }: { name: string; seed: string }) {
  return (
    <span className="nb-chord" style={wobbleStyle(seed + name, 1.5, 0.02)}>
      {name}
    </span>
  );
}

/** A line of handwriting: each word wobbles a little; chords are picked out when `chords` is set. */
function Words({ text, seed, chords }: { text: string; seed: string; chords?: boolean }) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((p, i) => {
        if (!p.trim()) return p;
        if (chords && isChordToken(p)) return <Chord key={i} name={p} seed={`${seed}-${i}`} />;
        return (
          <span key={i} className="inline-block" style={wobbleStyle(`${seed}-${i}-${p}`, 1.1, 0.025)}>
            {p}
          </span>
        );
      })}
    </>
  );
}

/** Is this a shorthand line like "Verse: D | F#m | Bm | G" (mostly chords)? */
function isMostlyChords(text: string): boolean {
  const words = text.split(/\s+|\|/).filter((p) => p && !p.endsWith(":"));
  return words.length > 0 && words.filter(isChordToken).length / words.length >= 0.6;
}

/** Chord-over-lyric line that can wrap at any word (same grouping as ChordSheet's PairedLine). */
function PairedRow({ segments, seed }: { segments: Segment[]; seed: string }) {
  type Unit = { chord: string; text: string };
  const units: Unit[] = [];
  // A chord placed over the gap before a word belongs to that word: hand the
  // gap to the lyric before it, so the chord doesn't sit over a space and
  // push the words apart.
  const segs: Segment[] = [];
  for (const seg of segments) {
    const lead = /^\s+(?=\S)/.exec(seg.text ?? "")?.[0];
    if (lead && seg.chord) {
      const prev = segs[segs.length - 1];
      if (prev) prev.text = (prev.text ?? "") + lead;
      else segs.push({ text: lead });
      segs.push({ chord: seg.chord, text: seg.text!.slice(lead.length) });
    } else {
      segs.push({ ...seg });
    }
  }
  for (const seg of segs) {
    const words = (seg.text ?? "").split(/(?<=\s)(?=\S)/);
    words.forEach((w, k) => units.push({ chord: k === 0 ? seg.chord ?? "" : "", text: w }));
  }
  const groups: Unit[][] = [];
  units.forEach((u, i) => {
    const prev = i > 0 ? units[i - 1].text : "";
    const glued = i > 0 && /\S$/.test(prev) && /^\S/.test(u.text);
    if (glued && groups.length) groups[groups.length - 1].push(u);
    else groups.push([u]);
  });
  return (
    <>
      {groups.map((group, g) => (
        <span key={g} className="inline-block whitespace-nowrap align-top">
          {group.map((u, j) => {
            const word = u.text.trimEnd();
            const space = u.text.slice(word.length);
            return (
              <span key={j} className="inline-block whitespace-pre align-top">
                <span className={`nb-chord-row ${u.chord ? "pr-[0.35em]" : ""}`}>
                  {u.chord ? <Chord name={u.chord} seed={`${seed}-${g}-${j}`} /> : "​"}
                </span>
                <span className="block">
                  {word ? (
                    // Only whole words wobble; the pieces of a word a chord splits stay joined up
                    <span
                      className="inline-block"
                      style={group.length === 1 ? wobbleStyle(`${seed}-${g}-${word}`, 1.1, 0.025) : undefined}
                    >
                      {word}
                    </span>
                  ) : null}
                  {space || (word ? "" : " ")}
                </span>
              </span>
            );
          })}
        </span>
      ))}
    </>
  );
}

interface NotebookSheetProps {
  text: string;
  wrapText: boolean;
  lyricsOnly?: boolean;
}

export default function NotebookSheet({ text, wrapText, lyricsOnly }: NotebookSheetProps) {
  const rows = toRows(text);
  const wrap = wrapText ? "whitespace-pre-wrap" : "whitespace-pre";

  return (
    <div className={wrapText ? "" : "overflow-x-auto"}>
      {rows.map((row, i): ReactNode => {
        const seed = String(i);
        switch (row.type) {
          case "empty":
            return <div key={i} className="nb-blank" />;
          case "header":
            return (
              <div key={i} className="whitespace-pre">
                <span className="nb-heading">{row.text.trim().replace(/^\[|\]$/g, "")}</span>
              </div>
            );
          case "tab": {
            if (lyricsOnly) return null;
            // Tab lines are half a rule tall; pad an odd count so what follows is back on the lines
            const odd = row.text.split("\n").length % 2 === 1;
            return (
              <pre key={i} className={`nb-tab ${odd ? "nb-tab-odd" : ""}`}>
                {row.text}
              </pre>
            );
          }
          case "chords":
            if (lyricsOnly) return null;
            return (
              <div key={i} className="whitespace-pre">
                <Words text={row.text} seed={seed} chords />
              </div>
            );
          case "text":
            return (
              <div key={i} className={wrap}>
                <Words text={row.text} seed={seed} chords={!lyricsOnly && isMostlyChords(row.text)} />
              </div>
            );
          case "paired": {
            if (lyricsOnly) {
              const lyric = row.segments.map((s) => s.text || "").join("");
              if (!lyric.trim()) return <div key={i} className="nb-blank" />;
              return (
                <div key={i} className={wrap}>
                  <Words text={lyric} seed={seed} />
                </div>
              );
            }
            return (
              <div key={i} className={wrapText ? "" : "whitespace-nowrap"}>
                <PairedRow segments={row.segments} seed={seed} />
              </div>
            );
          }
        }
      })}
    </div>
  );
}

/** The sheet of ruled paper the chart is written on, with the song title across the top. */
export function NotebookPage({
  title,
  subtitle,
  fontClass,
  children,
}: {
  title: string;
  subtitle?: string;
  fontClass: string;
  children: ReactNode;
}) {
  return (
    <div className={`nb-page ${fontClass}`}>
      <div className="nb-title">{title}</div>
      {subtitle && <div className="nb-title-sub">{subtitle}</div>}
      <div className="nb-blank" />
      {children}
    </div>
  );
}
