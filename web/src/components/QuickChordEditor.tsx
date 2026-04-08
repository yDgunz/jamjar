import { useState, useRef, useEffect, useCallback } from "react";

// --- Music theory for chord suggestions ---

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// Major scale intervals (in semitones from root)
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
// Qualities for each scale degree in major key: I ii iii IV V vi vii°
const MAJOR_QUALITIES = ["", "m", "m", "", "", "m", "dim"];

const CHORD_RE =
  /^[A-G][#b]?(m|min|maj|dim|aug|sus[24]?|add[249]?|M|Maj)?[0-9]*(\/[A-G][#b]?)?$/;

function rootIndex(root: string): number {
  const si = SHARPS.indexOf(root);
  if (si !== -1) return si;
  return FLATS.indexOf(root);
}

function extractRoot(chord: string): string | null {
  const m = chord.match(/^([A-G][#b]?)/);
  return m ? m[1] : null;
}

function isMinor(chord: string): boolean {
  const stripped = chord.replace(/^[A-G][#b]?/, "").replace(/\/[A-G][#b]?$/, "");
  return /^(m|min)/.test(stripped);
}

/** Guess the key from a list of chords. Simple heuristic: first chord, adjusted for minor. */
function guessKey(chords: string[]): { root: number; minor: boolean; flats: boolean } | null {
  if (chords.length === 0) return null;
  const first = chords[0];
  const r = extractRoot(first);
  if (!r) return null;
  const idx = rootIndex(r);
  if (idx === -1) return null;
  const min = isMinor(first);
  const flatCount = chords.filter((c) => c.includes("b")).length;
  const sharpCount = chords.filter((c) => c.includes("#")).length;
  return { root: min ? (idx + 3) % 12 : idx, minor: min, flats: flatCount > sharpCount };
}

/** Get diatonic chords for a key */
function getDiatonicChords(key: { root: number; flats: boolean }): string[] {
  const scale = key.flats ? FLATS : SHARPS;
  return MAJOR_SCALE.map((interval, i) => {
    const noteIdx = (key.root + interval) % 12;
    return scale[noteIdx] + MAJOR_QUALITIES[i];
  });
}

// --- Standard sections ---

const STANDARD_SECTIONS = ["Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Outro"] as const;

interface Section {
  id: string;
  label: string;
  chords: string;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 9);
}

// --- Parse existing quick-chord format back into sections ---

function parseSheetToSections(sheet: string): Section[] | null {
  if (!sheet.trim()) return null;
  const lines = sheet.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const headerMatch = line.match(/^\s*\[(.+)\]\s*$/);
    if (headerMatch) {
      if (current) sections.push(current);
      current = { id: generateId(), label: headerMatch[1], chords: "" };
    } else if (current && line.trim()) {
      // Append chord content
      current.chords = current.chords ? current.chords + " " + line.trim() : line.trim();
    }
  }
  if (current) sections.push(current);

  // Only return if we found sections with chords
  if (sections.length > 0 && sections.some((s) => s.chords)) return sections;
  return null;
}

// --- Auto-capitalize chord input ---

/** Auto-capitalize chord tokens as the user types: e -> E, f#m -> F#m, bb7 -> Bb7 */
function autoCapitalizeChords(input: string): string {
  // Split on spaces, preserving trailing space
  const trailing = input.endsWith(" ") ? " " : "";
  const tokens = input.split(/\s+/).filter(Boolean);
  const fixed = tokens.map((token) => {
    // Match a chord-like pattern: letter optionally followed by # or b, then quality
    const m = token.match(/^([a-gA-G])([#b]?)(.*)$/);
    if (!m) return token;
    const [, root, accidental, rest] = m;
    return root.toUpperCase() + accidental + rest;
  });
  return fixed.join(" ") + trailing;
}

// --- Modifier buttons ---

const MODIFIERS = ["m", "7", "m7", "maj7", "sus4", "sus2", "dim", "aug", "add9", "/"] as const;

// --- Component ---

interface QuickChordEditorProps {
  onSave: (sheet: string) => void;
  onCancel: () => void;
  initialSheet?: string;
}

export default function QuickChordEditor({ onSave, onCancel, initialSheet }: QuickChordEditorProps) {
  const [sections, setSections] = useState<Section[]>(() => {
    if (initialSheet) {
      const parsed = parseSheetToSections(initialSheet);
      if (parsed) return parsed;
    }
    return [{ id: generateId(), label: "Intro", chords: "" }];
  });
  const [focusedSection, setFocusedSection] = useState<string | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Collect all entered chords for key detection
  const allChords = sections
    .flatMap((s) => s.chords.split(/\s+/).filter((c) => c && CHORD_RE.test(c)));
  const guessedKey = guessKey(allChords);
  const suggestions = guessedKey ? getDiatonicChords(guessedKey) : [];

  const addSection = useCallback((label: string) => {
    const newSection = { id: generateId(), label, chords: "" };
    setSections((prev) => [...prev, newSection]);
    // Focus the new section's input after render
    setTimeout(() => {
      inputRefs.current.get(newSection.id)?.focus();
    }, 0);
  }, []);

  const updateSection = useCallback((id: string, updates: Partial<Section>) => {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }, []);

  const removeSection = useCallback((id: string) => {
    setSections((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const moveSection = useCallback((id: string, direction: -1 | 1) => {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
  }, []);

  const toSheet = useCallback((): string => {
    return sections
      .filter((s) => s.chords.trim())
      .map((s) => `[${s.label}]\n${s.chords.trim().split(/\s+/).join("  ")}`)
      .join("\n\n");
  }, [sections]);

  const handleSave = () => {
    onSave(toSheet());
  };

  // Apply a modifier (m, 7, sus4, etc.) to the last chord in the focused section
  const applyModifier = (modifier: string) => {
    if (!focusedSection) return;
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== focusedSection) return s;
        const trimmed = s.chords.trimEnd();
        if (!trimmed) return s;
        // If modifier is "/", append it so user types the bass note next
        if (modifier === "/") {
          return { ...s, chords: trimmed + "/" };
        }
        // Find the last token and append the modifier
        const lastSpace = trimmed.lastIndexOf(" ");
        const lastChord = trimmed.slice(lastSpace + 1);
        // Extract just the root+accidental to avoid double-modifiers
        const rootMatch = lastChord.match(/^([A-G][#b]?)/);
        if (!rootMatch) return s;
        const newChord = rootMatch[1] + modifier;
        const prefix = lastSpace >= 0 ? trimmed.slice(0, lastSpace + 1) : "";
        return { ...s, chords: prefix + newChord + " " };
      }),
    );
    // Re-focus the input
    setTimeout(() => {
      const input = inputRefs.current.get(focusedSection);
      if (input) {
        input.focus();
        input.selectionStart = input.selectionEnd = input.value.length + 10;
      }
    }, 0);
  };

  // Insert a suggested chord at the focused section
  const insertChord = (chord: string) => {
    if (!focusedSection) return;
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== focusedSection) return s;
        const newChords = s.chords.trim() ? s.chords.trimEnd() + " " + chord : chord;
        return { ...s, chords: newChords };
      }),
    );
    // Re-focus the input
    setTimeout(() => {
      const input = inputRefs.current.get(focusedSection);
      if (input) {
        input.focus();
        // Move cursor to end
        input.selectionStart = input.selectionEnd = input.value.length + chord.length + 1;
      }
    }, 0);
  };

  // Keyboard shortcut: Cmd/Ctrl+Enter to save, Escape to cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  // Which standard sections haven't been added yet
  const unusedSections = STANDARD_SECTIONS.filter(
    (name) => !sections.some((s) => s.label.toLowerCase() === name.toLowerCase()),
  );

  const [customLabel, setCustomLabel] = useState("");

  return (
    <div className="space-y-3">
      {/* Section rows */}
      {sections.map((section, idx) => (
        <div key={section.id} className="flex items-center gap-1.5 sm:gap-2">
          {/* Section label */}
          <input
            value={section.label}
            onChange={(e) => updateSection(section.id, { label: e.target.value })}
            className="w-20 sm:w-24 shrink-0 rounded border border-gray-700 bg-gray-800 px-2 py-2 sm:py-1.5 text-xs font-medium text-gray-300 focus:border-accent-500 focus:outline-none"
            placeholder="Section"
          />

          {/* Chord input */}
          <input
            ref={(el) => {
              if (el) inputRefs.current.set(section.id, el);
              else inputRefs.current.delete(section.id);
            }}
            value={section.chords}
            onChange={(e) => updateSection(section.id, { chords: autoCapitalizeChords(e.target.value) })}
            onFocus={() => setFocusedSection(section.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                // Add a new section below and focus it
                const newSection = { id: generateId(), label: "", chords: "" };
                setSections((prev) => {
                  const copy = [...prev];
                  copy.splice(idx + 1, 0, newSection);
                  return copy;
                });
                setTimeout(() => inputRefs.current.get(newSection.id)?.focus(), 0);
              }
              if (e.key === "Backspace" && !section.chords && sections.length > 1) {
                e.preventDefault();
                removeSection(section.id);
                // Focus previous section
                const prevSection = sections[idx - 1] ?? sections[idx + 1];
                if (prevSection) {
                  setTimeout(() => {
                    const input = inputRefs.current.get(prevSection.id);
                    if (input) {
                      input.focus();
                      input.selectionStart = input.selectionEnd = input.value.length;
                    }
                  }, 0);
                }
              }
            }}
            className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-2 sm:py-1.5 text-base sm:text-sm text-white font-mono placeholder-gray-500 focus:border-accent-500 focus:outline-none"
            placeholder="E  F#m  A  B7"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />

          {/* Remove button (always visible); reorder buttons hidden on mobile */}
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              onClick={() => moveSection(section.id, -1)}
              disabled={idx === 0}
              className="hidden sm:block rounded p-1 text-gray-600 hover:text-gray-400 disabled:opacity-30"
              title="Move up"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              onClick={() => moveSection(section.id, 1)}
              disabled={idx === sections.length - 1}
              className="hidden sm:block rounded p-1 text-gray-600 hover:text-gray-400 disabled:opacity-30"
              title="Move down"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              onClick={() => removeSection(section.id)}
              disabled={sections.length === 1}
              className="rounded p-1.5 sm:p-1 text-gray-600 hover:text-red-400 disabled:opacity-30"
              title="Remove section"
            >
              <svg className="h-4 w-4 sm:h-3 sm:w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ))}

      {/* Add section buttons */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-1.5">
        {unusedSections.map((name) => (
          <button
            key={name}
            onClick={() => addSection(name)}
            className="rounded border border-gray-700 px-2.5 py-1.5 sm:px-2 sm:py-1 text-xs text-gray-400 hover:border-gray-600 hover:text-gray-300 active:bg-gray-800"
          >
            + {name}
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const label = customLabel.trim();
            if (label) {
              addSection(label);
              setCustomLabel("");
            }
          }}
          className="flex items-center gap-1"
        >
          <input
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            placeholder="Custom..."
            className="w-20 rounded border border-gray-700 bg-transparent px-2 py-1.5 sm:py-1 text-xs text-gray-400 placeholder-gray-600 focus:border-accent-500 focus:outline-none"
          />
          {customLabel.trim() && (
            <button
              type="submit"
              className="rounded border border-gray-700 px-2 py-1.5 sm:py-1 text-xs text-gray-400 hover:border-gray-600 hover:text-gray-300"
            >
              +
            </button>
          )}
        </form>
      </div>

      {/* Chord suggestions */}
      {suggestions.length > 0 && focusedSection && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-600">
            Key of {SHARPS[guessedKey!.root]}:
          </span>
          {suggestions.map((chord) => (
            <button
              key={chord}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur
                insertChord(chord);
              }}
              className={`rounded-full border px-3 py-1 sm:px-2.5 sm:py-0.5 text-sm sm:text-xs font-medium transition active:scale-95 ${
                allChords.includes(chord)
                  ? "border-accent-600 bg-accent-900/30 text-accent-400"
                  : "border-gray-700 text-gray-400 hover:border-accent-600 hover:text-accent-300"
              }`}
            >
              {chord}
            </button>
          ))}
        </div>
      )}

      {/* Modifier buttons */}
      {focusedSection && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-600">Modify:</span>
          {MODIFIERS.map((mod) => (
            <button
              key={mod}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur
                applyModifier(mod);
              }}
              className="rounded border border-gray-700 px-2.5 py-1 sm:px-2 sm:py-0.5 text-sm sm:text-xs font-mono text-gray-400 hover:border-gray-600 hover:text-gray-300 active:bg-gray-800 active:scale-95 transition"
            >
              {mod}
            </button>
          ))}
        </div>
      )}

      {/* Save / Cancel */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          className="rounded bg-accent-600 px-3 py-1.5 text-xs text-white hover:bg-accent-500"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-white"
        >
          Cancel
        </button>
        <span className="hidden text-xs text-gray-600 sm:inline">
          Enter to add row &middot; Backspace to remove empty &middot; {"\u2318"}Enter to save
        </span>
      </div>
    </div>
  );
}
