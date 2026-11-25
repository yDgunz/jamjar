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
