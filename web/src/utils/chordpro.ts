import { usesFlats } from "./chordUtils";

const CHORD_RE =
  /^[A-G][#b]?(m|min|maj|dim|aug|sus[24]?|add[249]?|M|Maj)?[0-9]*(\/[A-G][#b]?)?$/;

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === "")) return false;
  return tokens.every((t) => CHORD_RE.test(t));
}

function isHeaderLine(line: string): boolean {
  return /^\s*\[.*\]\s*$/.test(line);
}

/** Returns true if text contains at least one [ChordName] pattern */
export function isChordPro(text: string): boolean {
  const matches = [...text.matchAll(/\[([^\]]+)\]/g)];
  return matches.some((m) => CHORD_RE.test(m[1]));
}

/** Convert chords-above-lyrics format to ChordPro format */
export function toChordPro(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      result.push("");
      i++;
    } else if (isHeaderLine(line)) {
      result.push(line);
      i++;
    } else if (isChordLine(line)) {
      const next = i + 1 < lines.length ? lines[i + 1] : undefined;
      if (next !== undefined && next.trim() !== "" && !isChordLine(next) && !isHeaderLine(next)) {
        result.push(mergeChordLyric(line, next));
        i += 2;
      } else {
        // Chords-only line: wrap each chord in brackets
        result.push(line.replace(/\S+/g, (match) => `[${match}]`));
        i++;
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join("\n");
}

/** Merge a chord line and lyric line into ChordPro format */
function mergeChordLyric(chordLine: string, lyricLine: string): string {
  const chords: { chord: string; col: number }[] = [];
  for (const m of chordLine.matchAll(/\S+/g)) {
    chords.push({ chord: m[0], col: m.index });
  }

  if (chords.length === 0) return lyricLine;

  let result = "";
  let lastCol = 0;

  for (const { chord, col } of chords) {
    if (col > lastCol) {
      result += lyricLine.slice(lastCol, col);
    }
    result += `[${chord}]`;
    lastCol = Math.max(lastCol, col);
  }

  if (lastCol < lyricLine.length) {
    result += lyricLine.slice(lastCol);
  }

  return result.trimEnd();
}

function transposeRoot(root: string, semitones: number, preferFlats: boolean): string {
  const scale = preferFlats ? FLATS : SHARPS;
  const idx = SHARPS.indexOf(root) !== -1 ? SHARPS.indexOf(root) : FLATS.indexOf(root);
  if (idx === -1) return root;
  return scale[((idx + semitones) % 12 + 12) % 12];
}

function transposeChord(chord: string, semitones: number, preferFlats: boolean): string {
  return chord.replace(/([A-G][#b]?)/g, (root) => transposeRoot(root, semitones, preferFlats));
}

/** Transpose all chords inside [...] brackets in ChordPro text */
export function transposeChordPro(text: string, semitones: number): string {
  if (semitones === 0) return text;
  const preferFlats = usesFlats(text);

  return text.replace(/\[([^\]]+)\]/g, (_match, content: string) => {
    if (CHORD_RE.test(content)) {
      return `[${transposeChord(content, semitones, preferFlats)}]`;
    }
    return _match;
  });
}

/** Parsed segment for rendering */
export interface ChordProSegment {
  chord?: string;
  text: string;
}

export type ChordProLine =
  | { type: "paired"; segments: ChordProSegment[] }
  | { type: "text"; text: string }
  | { type: "empty" };

/** Parse a single ChordPro line into segments for rendering */
export function parseChordProLine(line: string): ChordProLine {
  if (line.trim() === "") return { type: "empty" };

  const hasChords = [...line.matchAll(/\[([^\]]+)\]/g)].some((m) => CHORD_RE.test(m[1]));
  if (!hasChords) return { type: "text", text: line };

  const segments: ChordProSegment[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    const match = remaining.match(/\[([^\]]+)\]/);
    if (!match || match.index === undefined) {
      if (remaining) {
        if (segments.length > 0) {
          segments[segments.length - 1].text += remaining;
        } else {
          segments.push({ text: remaining });
        }
      }
      break;
    }

    const beforeBracket = remaining.slice(0, match.index);
    const bracketContent = match[1];
    const afterBracket = remaining.slice(match.index + match[0].length);

    if (CHORD_RE.test(bracketContent)) {
      if (beforeBracket) {
        if (segments.length > 0) {
          segments[segments.length - 1].text += beforeBracket;
        } else {
          segments.push({ text: beforeBracket });
        }
      }
      segments.push({ chord: bracketContent, text: "" });
    } else {
      const plainText = beforeBracket + match[0];
      if (segments.length > 0) {
        segments[segments.length - 1].text += plainText;
      } else {
        segments.push({ text: plainText });
      }
    }

    remaining = afterBracket;
  }

  if (segments.every((s) => !s.chord)) {
    return { type: "text", text: line };
  }

  return { type: "paired", segments };
}
