// Chromatic scale in sharps and flats
const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

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

/** Map every note to its fret on the low E string */
const E_STRING_FRET: Record<string, number> = {
  E: 0, F: 1, "F#": 2, Gb: 2, G: 3, "G#": 4, Ab: 4,
  A: 5, "A#": 6, Bb: 6, B: 7, C: 8, "C#": 9, Db: 9,
  D: 10, "D#": 11, Eb: 11,
};

/** Annotate each chord in a chart string with its E-string root fret, e.g. Am → Am(5) */
export function annotateEStringRoots(text: string): string {
  return text.replace(/\b([A-G][#b]?)(?=[m\d(Madisu/|)\s\n,\-–—]|$)/g, (match, root: string) => {
    const fret = E_STRING_FRET[root];
    return fret !== undefined ? `${match}(${fret})` : match;
  });
}

/** Format semitone offset for display, e.g. +3, -2, or empty for 0 */
export function formatTranspose(semitones: number): string {
  if (semitones === 0) return "";
  return semitones > 0 ? `+${semitones}` : `${semitones}`;
}
