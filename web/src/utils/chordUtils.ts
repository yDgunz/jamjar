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
