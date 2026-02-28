const CHORD_RE = /^[A-G][#b]?(m|min|maj|dim|aug|sus[24]?|add[249]?|M|Maj)?[0-9]*(\/[A-G][#b]?)?$/;

export function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === "")) return false;
  return tokens.every((t) => CHORD_RE.test(t));
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

export type ParsedLine =
  | { type: "paired"; segments: Segment[] }
  | { type: "chords-only"; text: string }
  | { type: "header"; text: string }
  | { type: "text"; text: string }
  | { type: "empty" };

export function parseSheet(text: string): ParsedLine[] {
  const lines = text.split("\n");
  const result: ParsedLine[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      result.push({ type: "empty" });
      i++;
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
