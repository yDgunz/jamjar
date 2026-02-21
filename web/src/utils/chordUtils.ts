// Chromatic scale in sharps and flats
const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// Maps each note to its position on the E or A string
export const BASS_POSITIONS: Record<string, { string: string; fret: number }> = {
  E:    { string: "E", fret: 0 },
  F:    { string: "E", fret: 1 },
  "F#": { string: "E", fret: 2 }, Gb: { string: "E", fret: 2 },
  G:    { string: "E", fret: 3 },
  "G#": { string: "E", fret: 4 }, Ab: { string: "E", fret: 4 },
  A:    { string: "A", fret: 0 },
  "A#": { string: "A", fret: 1 }, Bb: { string: "A", fret: 1 },
  B:    { string: "A", fret: 2 },
  C:    { string: "A", fret: 3 },
  "C#": { string: "A", fret: 4 }, Db: { string: "A", fret: 4 },
  D:    { string: "A", fret: 5 },
  "D#": { string: "A", fret: 6 }, Eb: { string: "A", fret: 6 },
};

export interface ChartSection {
  label: string;
  chords: { name: string; root: string; string: string; fret: number }[];
}

export function parseChartSections(chart: string): ChartSection[] {
  const sections: ChartSection[] = [];
  for (const line of chart.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    const label = colonIdx >= 0 ? trimmed.slice(0, colonIdx).trim() : "";
    const chordsStr = colonIdx >= 0 ? trimmed.slice(colonIdx + 1) : trimmed;
    const chordMatches = chordsStr.match(/\b([A-G][#b]?[^|\s]*)/g);
    if (!chordMatches || chordMatches.length === 0) continue;
    const chords = chordMatches.map((name) => {
      const rootMatch = name.match(/^([A-G][#b]?)/);
      const root = rootMatch ? rootMatch[1] : name;
      const pos = BASS_POSITIONS[root];
      return { name, root, string: pos?.string ?? "", fret: pos?.fret ?? -1 };
    }).filter((c) => c.fret >= 0);
    if (chords.length > 0) sections.push({ label, chords });
  }
  return sections;
}

export function renderSectionTab(section: ChartSection): string {
  const { chords } = section;
  const strings = ["A", "E"];
  const colW = Math.max(...chords.map((c) => c.name.length), 2) + 1;

  const lines = strings.map((s) => {
    const cells = chords.map((c) => {
      const val = c.string === s ? String(c.fret) : "\u2013";
      return val.padStart(colW);
    });
    return `${s}|${cells.join("")}`;
  });
  return lines.join("\n");
}

/** Detect whether a chart predominantly uses flats */
export function usesFlats(text: string): boolean {
  const flatCount = (text.match(/[A-G]b/g) || []).length;
  const sharpCount = (text.match(/[A-G]#/g) || []).length;
  return flatCount > sharpCount;
}

/** Transpose a single root note by semitones */
function transposeRoot(root: string, semitones: number, preferFlats: boolean): string {
  const scale = preferFlats ? FLATS : SHARPS;
  const idx = SHARPS.indexOf(root) !== -1 ? SHARPS.indexOf(root) : FLATS.indexOf(root);
  if (idx === -1) return root;
  return scale[((idx + semitones) % 12 + 12) % 12];
}

/** Transpose all chord names in a chart string by semitones, preserving all formatting */
export function transposeChartText(text: string, semitones: number): string {
  if (semitones === 0) return text;
  const preferFlats = usesFlats(text);
  // Match chord roots (A-G optionally followed by # or b) that appear at word boundaries
  // followed by chord quality (m, maj, min, dim, aug, sus, 7, 9, etc.)
  return text.replace(/\b([A-G][#b]?)(?=[m\d(Madisu/|)\s\n,\-–—]|$)/g, (_match, root: string) => {
    return transposeRoot(root, semitones, preferFlats);
  });
}

/** Format semitone offset for display, e.g. +3, -2, or empty for 0 */
export function formatTranspose(semitones: number): string {
  if (semitones === 0) return "";
  return semitones > 0 ? `+${semitones}` : `${semitones}`;
}
