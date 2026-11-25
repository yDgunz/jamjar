import { isChordLine, isHeaderLine } from "./sheetParser";

/** A line of tablature: a string name, a bar, dashes. "e|--3--", "F#|-0-", "D:--2--". */
export function isStaffLine(line: string): boolean {
  return /^\s*[A-Ga-g][#b]?\s?[|:]/.test(line) && (line.match(/-/g) ?? []).length >= 4;
}

export type TabBlock =
  /** `[Intro]`: a named part of the song */
  | { type: "section"; title: string }
  /**
   * One system of tablature. `labels` sit over it and line up with it by
   * column (chord names); `beats` is a count line under it.
   */
  | { type: "staff"; labels: string[]; lines: string[]; beats: string[] }
  /** A direction or remark ("play twice", "with intro chords") */
  | { type: "note"; text: string; tight: boolean }
  /** A line of chord names on its own */
  | { type: "chords"; text: string }
  /** Chords over lyrics, drawn like a chart */
  | { type: "sheet"; text: string };

const LEGEND_ENTRY_RE =
  /^[\s|*]*\(?(?:[hpbrstvx]|br|pb|b\^|sl|[/\\~^<>*x.()]{1,3}|[npa]\.[hm]\.?|\d+[hpb/\\]\d+)\)?\s*[-=:.>]*\s*(?:hammer|pull|bend|release|slide|vibrato|dead note|muted?|palm mut|sustain|return|harmonic|natural harm|pinch harm|tap|tapping|ghost note|let ring|tremolo|trill)[\w\s\-/().,']{0,40}$/i;
const LEGEND_TITLE_RE = /^\W*(?:tab(?:lature)?\s+)?(?:legend|symbols?|notation)\W*$/i;
const RULE_RE = /^\s*([*=_~#+-])\1{5,}\s*$/;

/** A symbol-legend line or a row of asterisks: the viewer has its own legend. */
function isClutter(line: string): boolean {
  const t = line.trim();
  return RULE_RE.test(line) || LEGEND_TITLE_RE.test(line) || (t.length <= 60 && LEGEND_ENTRY_RE.test(line));
}

/**
 * Does this line over a staff line up with it by column (chord names, a few
 * marks), rather than being a sentence?
 */
function isAlignedLabel(line: string): boolean {
  if (isChordLine(line)) return true;
  if (/[A-Za-z',]{2,} [A-Za-z',]{2,} [A-Za-z',]{2,}/.test(line) || /[:.!?]$/.test(line.trim())) return false;
  // Positioned by spaces: indented, or with gaps between its marks
  return line.trim().length <= 40 && (/^\s{2,}\S/.test(line) || /\S\s{2,}\S/.test(line));
}

/** "(play this fill once)", "solo with above chords:": an instruction, not a lyric */
function isDirection(line: string): boolean {
  const t = line.trim();
  return t.startsWith("(") || t.endsWith(":");
}

export function parseTab(text: string): TabBlock[] {
  const lines = text.replace(/\t/g, "    ").split("\n").map((l) => l.trimEnd());
  const blocks: TabBlock[] = [];
  let pending: string[] = [];

  const flushText = (run: string[], tight: boolean) => {
    if (run.length === 0) return;
    const paired = run.some(
      (l, k) =>
        isChordLine(l) && k + 1 < run.length && !isChordLine(run[k + 1]) && !isDirection(run[k + 1]),
    );
    if (paired) {
      blocks.push({ type: "sheet", text: run.join("\n") });
      return;
    }
    // Sentences broken over several lines read as one paragraph; a direction
    // in brackets or a line ending in a colon keeps its own line
    let para: string[] = [];
    const flushPara = (isLast: boolean) => {
      if (para.length) blocks.push({ type: "note", text: para.join(" "), tight: tight && isLast });
      para = [];
    };
    run.forEach((l, k) => {
      const t = l.trim();
      if (isChordLine(l)) {
        flushPara(false);
        blocks.push({ type: "chords", text: l });
        return;
      }
      if (t.startsWith("(") || /[:)]$/.test(para[para.length - 1] ?? "")) flushPara(false);
      para.push(t);
      if (k === run.length - 1) flushPara(true);
    });
    flushPara(true);
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      flushText(pending, false);
      pending = [];
      i++;
    } else if (isStaffLine(line)) {
      const staff: string[] = [];
      while (i < lines.length && isStaffLine(lines[i])) staff.push(lines[i++]);
      const beats: string[] = [];
      while (i < lines.length && /^[\s\d&+.|]+$/.test(lines[i]) && /\d/.test(lines[i])) beats.push(lines[i++]);
      // Lines right over the staff that line up with it travel with it
      const labels: string[] = [];
      while (pending.length > 0 && labels.length < 3 && isAlignedLabel(pending[pending.length - 1])) {
        labels.unshift(pending.pop()!);
      }
      flushText(pending, true);
      pending = [];
      blocks.push({ type: "staff", labels, lines: staff, beats });
    } else if (isHeaderLine(line)) {
      flushText(pending, false);
      pending = [];
      blocks.push({ type: "section", title: line.trim().replace(/^\[\s*|\s*\]$/g, "") });
      i++;
    } else {
      if (!isClutter(line)) pending.push(line);
      i++;
    }
  }
  flushText(pending, false);
  return blocks;
}

export interface StaffChunk {
  labels: string[];
  lines: string[];
  beats: string[];
}

/**
 * Break a staff that is wider than `cols` characters into rows that fit,
 * cutting every string (and the labels over it) at the same column: at a bar
 * line where there is one, otherwise where every string has only dashes, so
 * no fret number or "5h7" is split. Each row repeats the string names.
 */
export function wrapStaff(staff: { labels: string[]; lines: string[]; beats: string[] }, cols: number): StaffChunk[] {
  const width = Math.max(...staff.lines.map((l) => l.length));
  const prefix = Math.max(...staff.lines.map((l) => l.search(/[|:]/) + 1));
  const room = cols - prefix;
  if (width <= cols || room < 16) return [staff];

  const pad = (l: string) => l.padEnd(width, " ");
  const lines = staff.lines.map(pad);
  const allAt = (c: number, ch: string) => lines.every((l) => l[c] === ch);

  const cuts: number[] = [];
  let start = prefix;
  while (width - start > room) {
    const limit = start + room;
    let cut = -1;
    // A bar line in the back half of the row: break after it
    for (let c = limit - 1; c >= start + Math.floor(room / 2); c--) {
      if (allAt(c, "|")) { cut = c + 1; break; }
    }
    if (cut < 0) {
      for (let c = limit; c > start + 8; c--) {
        if (allAt(c - 1, "-") && allAt(c, "-")) { cut = c; break; }
      }
    }
    if (cut < 0) cut = limit;
    cuts.push(cut);
    start = cut;
  }
  // Don't leave a last row holding only the closing bar
  if (cuts.length > 0 && lines.every((l) => /^[|\s-]{0,3}$/.test(l.slice(cuts[cuts.length - 1])))) cuts.pop();

  const bounds = [prefix, ...cuts, width];
  const chunks: StaffChunk[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [a, b] = [bounds[k], bounds[k + 1]];
    const slice = (l: string, lead: string) => (lead + pad(l).slice(a, b)).trimEnd();
    chunks.push({
      labels: staff.labels
        .map((l) => slice(l, k === 0 ? pad(l).slice(0, prefix) : " ".repeat(prefix)))
        .filter((l) => l.trim() !== ""),
      lines: staff.lines.map((l) => slice(l, l.slice(0, prefix).padEnd(prefix, " "))),
      beats: staff.beats
        .map((l) => slice(l, k === 0 ? pad(l).slice(0, prefix) : " ".repeat(prefix)))
        .filter((l) => l.trim() !== ""),
    });
  }
  return chunks;
}

/** The playing-technique symbols a tab's staffs use, in a fixed order. */
export const TAB_SYMBOLS: [string, string][] = [
  ["h", "hammer-on"],
  ["p", "pull-off"],
  ["b", "bend"],
  ["r", "release"],
  ["/", "slide up"],
  ["\\", "slide down"],
  ["s", "slide"],
  ["~", "vibrato"],
  ["x", "muted note"],
  ["t", "tap"],
  ["<>", "harmonic"],
  ["( )", "ghost note"],
];

export function symbolsUsed(blocks: TabBlock[]): [string, string][] {
  const body = blocks
    .flatMap((b) => (b.type === "staff" ? b.lines : []))
    .map((l) => l.slice(l.search(/[|:]/) + 1))
    .join("\n")
    .toLowerCase();
  return TAB_SYMBOLS.filter(([sym]) =>
    sym === "<>" ? /<\d+>/.test(body) : sym === "( )" ? /\(\d+\)/.test(body) : body.includes(sym),
  );
}

/** What to draw for one string of a staff. Positions are character columns. */
export type StaffMark =
  /** The string itself, from one column to another */
  | { kind: "line"; from: number; to: number }
  | { kind: "bar"; col: number }
  /** A fret number; `target` is the pitch a bend reaches, not a fretted note */
  | { kind: "fret"; col: number; text: string; target: boolean }
  /** Hammer-on or pull-off: an arc between the middles of two fret numbers */
  | { kind: "slur"; from: number; to: number }
  | { kind: "slide"; col: number; up: boolean }
  | { kind: "bend"; col: number; release: boolean }
  | { kind: "vibrato"; from: number; to: number }
  | { kind: "mute"; col: number }
  /** Anything else, written as it is */
  | { kind: "text"; col: number; text: string };

/**
 * Turn one line of tablature into things to draw: the string as a line with
 * gaps for its notes, bar lines, and playing techniques as marks (an arc for
 * "5h7", a slanted stroke for "5/7", an arrow for "7b9"). Whatever isn't
 * recognised stays as text in its own column, so nothing is lost.
 */
export function layoutStaffLine(line: string): { name: string; marks: StaffMark[] } {
  const at = line.search(/[|:]/) + 1;
  const marks: StaffMark[] = [];
  if (at > 0) marks.push({ kind: "bar", col: at - 1 });
  // The string ends at its last dash or bar; what follows ("x2") is a remark
  const end = Math.max(line.lastIndexOf("-"), line.lastIndexOf("|")) + 1;

  type Token = { col: number; text: string };
  const tokens: Token[] = [];
  const re = /-+|\|+|\d+|\s+|[^-|\d\s]+/g;
  re.lastIndex = at;
  for (let m = re.exec(line); m; m = re.exec(line)) tokens.push({ col: m.index, text: m[0] });

  const isFret = (t?: Token) => !!t && /^\d/.test(t.text);
  const mid = (t: Token) => t.col + t.text.length / 2;
  // Starts in the middle of the opening bar; stops a little short of each note
  let lineFrom = Math.max(at - 0.5, 0);
  const GAP = 0.15;
  const lineTo = (col: number) => {
    if (col > lineFrom) marks.push({ kind: "line", from: lineFrom, to: col });
  };

  tokens.forEach((t, k) => {
    const [prev, next] = [tokens[k - 1], tokens[k + 1]];
    const c = t.text[0];
    if (t.col >= end) {
      if (t.text.trim()) marks.push({ kind: "text", col: t.col, text: t.text });
    } else if (c === "-") {
      // part of the string
    } else if (c === "|") {
      for (let j = 0; j < t.text.length; j++) marks.push({ kind: "bar", col: t.col + j });
    } else if (isFret(t)) {
      lineTo(t.col - GAP);
      lineFrom = t.col + t.text.length + GAP;
      const before = prev?.text.toLowerCase();
      marks.push({ kind: "fret", col: t.col, text: t.text, target: before === "b" && isFret(tokens[k - 2]) });
    } else if (/^[hp]$/i.test(t.text) && isFret(prev) && isFret(next)) {
      marks.push({ kind: "slur", from: mid(prev), to: mid(next) });
    } else if (/^[/\\s]$/i.test(t.text) && (isFret(prev) || isFret(next))) {
      const up = c === "/" || (c !== "\\" && (!isFret(prev) || !isFret(next) || +next.text >= +prev.text));
      lineTo(t.col - GAP);
      lineFrom = t.col + 1 + GAP;
      marks.push({ kind: "slide", col: t.col, up });
    } else if (/^[br]$/i.test(t.text) && isFret(prev)) {
      lineTo(t.col - GAP);
      lineFrom = t.col + 1 + GAP;
      marks.push({ kind: "bend", col: t.col, release: c.toLowerCase() === "r" });
    } else if (/^~+$/.test(t.text)) {
      lineTo(t.col - GAP);
      lineFrom = t.col + t.text.length + GAP;
      marks.push({ kind: "vibrato", from: t.col, to: t.col + t.text.length });
    } else if (/^x+$/i.test(t.text)) {
      lineTo(t.col - GAP);
      lineFrom = t.col + t.text.length + GAP;
      for (let j = 0; j < t.text.length; j++) marks.push({ kind: "mute", col: t.col + j });
    } else if (t.text.trim()) {
      lineTo(t.col - GAP);
      lineFrom = t.col + t.text.length + GAP;
      marks.push({ kind: "text", col: t.col, text: t.text });
    }
  });
  lineTo(line[end - 1] === "|" ? end - 0.5 : end);
  return { name: at > 0 ? line.slice(0, at - 1) : "", marks };
}
