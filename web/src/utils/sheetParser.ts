// A chord: root, any run of qualities/extensions (m7b5, maj9, 7#9, sus4, add11,
// +, dim7, ø…), and an optional slash bass.
const CHORD_RE = /^[A-G][#b]?(?:maj|Maj|min|dim|aug|sus|add|m|M|\+|°|ø|[0-9]|[#b](?=[0-9]))*(?:\/[A-G][#b]?)?$/;

// Non-chord tokens that still belong on a chord line: separators, held-chord
// marks, repeat counts and short annotations like {twice} or (repeat).
const CHORD_LINE_EXTRA_RE =
  /^(-+|\/+|\|+|%|\.{2,}|\*+|\(?(?:x\d+|\d+x)\)?|N\.?C\.?|\{[^}]*\}|\((?:repeat|twice|x\d+|\d+x)\))$/i;

/**
 * A chord, allowing the decorations chord charts put around them: wrapping
 * parentheses, trailing * or _ (held), and hyphen-joined runs ("F/A-Bb-F/A").
 */
export function isChordToken(token: string): boolean {
  const t = token.replace(/^\(+/, "").replace(/[)*_]+$/, "");
  const parts = t.split("-").filter(Boolean);
  return parts.length > 0 && parts.every((p) => CHORD_RE.test(p));
}

export function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === "")) return false;
  return (
    tokens.every((t) => isChordToken(t) || CHORD_LINE_EXTRA_RE.test(t)) &&
    tokens.some(isChordToken)
  );
}

export function isHeaderLine(line: string): boolean {
  return /^\s*\[.*\]\s*$/.test(line);
}

export interface Segment {
  chord: string;
  lyric: string;
}

export function extractSegments(chordLine: string, lyricLine: string): Segment[] {
  // Find chord positions by matching non-space sequences in the chord line
  const segments: Segment[] = [];
  const chordMatches = [...chordLine.matchAll(/\S+/g)];

  if (chordMatches.length === 0) return [{ chord: "", lyric: lyricLine }];

  for (let i = 0; i < chordMatches.length; i++) {
    const start = chordMatches[i].index;
    const nextStart = i + 1 < chordMatches.length ? chordMatches[i + 1].index : undefined;
    const chord = chordMatches[i][0];
    const lyric = nextStart !== undefined
      ? lyricLine.slice(start, nextStart)
      : lyricLine.slice(start);
    segments.push({ chord, lyric });
  }

  // If there's lyric text before the first chord, prepend it as a chordless segment
  const firstChordStart = chordMatches[0].index;
  if (firstChordStart > 0) {
    segments.unshift({ chord: "", lyric: lyricLine.slice(0, firstChordStart) });
  }

  return segments;
}

/** A line of guitar tablature, e.g. "e|---3---|" or "B|-0-1-3-". */
export function isTabLine(line: string): boolean {
  return /^\s*[eEBGDAa]\s?[|:]/.test(line) && (line.match(/-/g) ?? []).length >= 4;
}

export type ParsedLine =
  | { type: "paired"; segments: Segment[] }
  | { type: "tab"; text: string }
  | { type: "chords-only"; text: string }
  | { type: "header"; text: string }
  | { type: "text"; text: string }
  | { type: "empty" };

/** Drop leading/trailing blank lines and squeeze runs of blank lines down to one. */
export function tidyBlankLines(text: string): string {
  return text
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

export function parseSheet(text: string): ParsedLine[] {
  const lines = text.split("\n");
  const result: ParsedLine[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      result.push({ type: "empty" });
      i++;
    } else if (isTabLine(line)) {
      // Keep a run of tab lines together so the staff lines up
      const block: string[] = [];
      while (i < lines.length && isTabLine(lines[i])) block.push(lines[i++]);
      // A beat-count line under the staff ("1 & 2 & 3 & 4 &") belongs with it
      while (i < lines.length && /^[\s\d&+.|]+$/.test(lines[i]) && /\d/.test(lines[i])) block.push(lines[i++]);
      result.push({ type: "tab", text: block.join("\n") });
    } else if (isHeaderLine(line)) {
      result.push({ type: "header", text: line });
      i++;
    } else if (isChordLine(line)) {
      // Look ahead: is the next line a non-chord, non-empty, non-header line?
      const next = i + 1 < lines.length ? lines[i + 1] : undefined;
      if (next !== undefined && next.trim() !== "" && !isChordLine(next) && !isHeaderLine(next)) {
        result.push({ type: "paired", segments: extractSegments(line, next) });
        i += 2;
      } else {
        result.push({ type: "chords-only", text: line });
        i++;
      }
    } else {
      result.push({ type: "text", text: line });
      i++;
    }
  }

  return result;
}
