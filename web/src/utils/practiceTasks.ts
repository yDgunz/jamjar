/**
 * Random five-minute guitar practice tasks.
 *
 * Each template picks its own parameters (key, position, tempo, chord...) so the
 * same exercise comes out differently each time. Everything is static: no
 * network calls, no AI.
 */

export type Category =
  | "Technique"
  | "Scales"
  | "Arpeggios"
  | "Chords"
  | "Ear"
  | "Fretboard"
  | "Rhythm"
  | "Improv";

export const CATEGORIES: Category[] = [
  "Technique",
  "Scales",
  "Arpeggios",
  "Chords",
  "Ear",
  "Fretboard",
  "Rhythm",
  "Improv",
];

export interface PracticeTask {
  id: string;
  category: Category;
  title: string;
  summary: string;
  steps: string[];
  /** Suggested metronome tempo, if the task uses one */
  bpm?: number;
  /** Beats per bar for the metronome (default 4) */
  beats?: number;
}

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const between = (lo: number, hi: number, step = 1) =>
  lo + step * Math.floor(Math.random() * (Math.floor((hi - lo) / step) + 1));

const MAJOR_KEYS = ["C", "G", "D", "A", "E", "F", "Bb", "Eb"] as const;
const MINOR_KEYS = ["A", "E", "B", "F#", "D", "G", "C"] as const;
const NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;
const NATURALS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const STRINGS = ["low E", "A", "D", "G", "B", "high E"] as const;
const STRING_SETS = ["G-B-high E", "D-G-B", "A-D-G", "low E-A-D"] as const;
const INTERVALS = [
  "minor 3rd",
  "major 3rd",
  "perfect 4th",
  "perfect 5th",
  "major 6th",
  "minor 7th",
  "octave",
  "major 2nd",
  "tritone",
] as const;
const MODES = [
  ["Dorian", "the natural 6th"],
  ["Mixolydian", "the flat 7th"],
  ["Lydian", "the sharp 4th"],
  ["Phrygian", "the flat 2nd"],
  ["Aeolian (natural minor)", "the flat 6th"],
] as const;
const SEVENTHS = [
  ["maj7", "1 3 5 7"],
  ["m7", "1 b3 5 b7"],
  ["7", "1 3 5 b7"],
  ["m7b5", "1 b3 b5 b7"],
] as const;

// Roman-numeral progressions rendered in a key
const SCALE: Record<string, string[]> = {
  C: ["C", "Dm", "Em", "F", "G", "Am"],
  G: ["G", "Am", "Bm", "C", "D", "Em"],
  D: ["D", "Em", "F#m", "G", "A", "Bm"],
  A: ["A", "Bm", "C#m", "D", "E", "F#m"],
  E: ["E", "F#m", "G#m", "A", "B", "C#m"],
  F: ["F", "Gm", "Am", "Bb", "C", "Dm"],
  Bb: ["Bb", "Cm", "Dm", "Eb", "F", "Gm"],
  Eb: ["Eb", "Fm", "Gm", "Ab", "Bb", "Cm"],
};
const PROGRESSIONS = [
  ["I-V-vi-IV", [0, 4, 5, 3]],
  ["I-vi-IV-V", [0, 5, 3, 4]],
  ["ii-V-I", [1, 4, 0]],
  ["I-IV-V", [0, 3, 4]],
  ["vi-IV-I-V", [5, 3, 0, 4]],
  ["I-iii-IV-V", [0, 2, 3, 4]],
] as const;
function progression(key: string): { name: string; chords: string } {
  const [name, degrees] = pick(PROGRESSIONS);
  return { name, chords: degrees.map((d) => SCALE[key][d]).join(" – ") };
}

type Template = () => Omit<PracticeTask, "id">;

const TEMPLATES: Record<Category, Template[]> = {
  Technique: [
    () => {
      const fret = between(1, 7);
      const bpm = between(60, 100, 5);
      return {
        category: "Technique",
        title: "Chromatic alternate picking",
        summary: `Strict down-up picking, four notes per string, starting at fret ${fret}.`,
        steps: [
          `On the low E string play frets ${fret}-${fret + 1}-${fret + 2}-${fret + 3} with fingers 1-2-3-4, then repeat it on every string up to high E and back down.`,
          "Pick strictly down-up-down-up, as eighth notes against the click.",
          "When a pass is clean, move the whole thing up one fret.",
          "After two clean passes in a row, add 5 BPM.",
        ],
        bpm,
      };
    },
    () => {
      const perm = pick(["1-3-2-4", "1-4-2-3", "2-4-1-3", "4-2-3-1", "1-3-4-2", "3-1-4-2"]);
      const fret = between(3, 9);
      return {
        category: "Technique",
        title: `Finger independence: ${perm}`,
        summary: "The \"spider\" drill. It's awkward on purpose, so stay slow and relaxed.",
        steps: [
          `Put finger 1 at fret ${fret}. Play the fingers in the order ${perm}, one finger per fret, on the low E string.`,
          "Move to the next string and repeat, all the way across and back.",
          "Keep the fingers you're not using hovering close to the strings.",
          "If your hand tenses up, stop, shake it out and slow the click down.",
        ],
        bpm: between(50, 80, 5),
      };
    },
    () => {
      const pair = pick(["1-2", "1-3", "1-4", "2-3", "2-4", "3-4"]);
      const string = pick(["G", "B", "D", "high E"]);
      const fret = between(5, 9);
      return {
        category: "Technique",
        title: `Legato trills: fingers ${pair}`,
        summary: "Hammer-ons and pull-offs with no picking after the first note.",
        steps: [
          `On the ${string} string, start at fret ${fret}. Trill with fingers ${pair}: pick once, then hammer on and pull off as evenly as you can.`,
          "Spend one minute on steady eighth notes, then one minute on sixteenths.",
          "Pull off slightly down toward the floor so the lower note rings as loud as the hammer-on.",
          "Finish by repeating it on another string.",
        ],
        bpm: between(60, 90, 5),
      };
    },
    () => {
      const string = pick(["G", "B"]);
      const fret = string === "G" ? pick([7, 9, 12, 14]) : pick([8, 10, 12, 15]);
      const step = pick(["whole step", "half step", "minor 3rd (1½ steps)"]);
      const target = step === "whole step" ? 2 : step === "half step" ? 1 : 3;
      return {
        category: "Technique",
        title: `Bend to pitch: ${step}`,
        summary: "Train your bends to land exactly in tune.",
        steps: [
          `On the ${string} string, play fret ${fret + target} to hear the target note.`,
          `Now play fret ${fret} and bend it up a ${step} until it matches the target.`,
          "Use two or three fingers behind the bending finger for support.",
          "Alternate: target, bend, target, bend. Then hold the bend and add slow, even vibrato.",
        ],
      };
    },
    () => {
      const bpm = between(70, 110, 5);
      return {
        category: "Technique",
        title: "Palm-muted chug with accents",
        summary: "Control dynamics with the picking hand alone.",
        steps: [
          "Play steady palm-muted eighth notes on an E5 or A5 power chord.",
          "Accent beat 1 of each bar by lifting the mute and digging in. Everything else stays tight.",
          "Next, move the accent: beat 2, then the \"and\" of 3, then beat 4.",
          "Keep the muted notes the same volume, so the accent is the only thing that changes.",
        ],
        bpm,
      };
    },
    () => {
      const key = pick(MAJOR_KEYS.slice(0, 6));
      return {
        category: "Technique",
        title: `Travis picking in ${key}`,
        summary: "Alternating thumb bass with melody fingers on top.",
        steps: [
          `Hold a ${key} chord. Your thumb alternates between the root and another bass string on every beat.`,
          "Add your index and middle fingers on the G and B strings between the thumb notes.",
          `Once it grooves, switch to the ${SCALE[key][3]} and ${SCALE[key][4]} chords without breaking the thumb pattern.`,
          "The thumb never stops. Let the fingers drop out if they need to.",
        ],
        bpm: between(60, 90, 5),
      };
    },
  ],
  Scales: [
    () => {
      const key = pick(MAJOR_KEYS);
      return {
        category: "Scales",
        title: `${key} major, three notes per string`,
        summary: "Even, fast-friendly fingering that covers two-plus octaves.",
        steps: [
          `Play ${key} major with three notes on every string, starting from the lowest ${key} on the low E string.`,
          "Go up and down three times at an easy tempo, as eighth notes.",
          "Then play it in groups of three (1-2-3, 2-3-4, 3-4-5…) ascending and descending.",
          "Name each note out loud on the last pass.",
        ],
        bpm: between(60, 90, 5),
      };
    },
    () => {
      const key = pick(MINOR_KEYS);
      const box = between(1, 4);
      return {
        category: "Scales",
        title: `${key} minor pentatonic: connect boxes ${box} and ${box + 1}`,
        summary: "Stop getting stuck in one shape.",
        steps: [
          `Play ${key} minor pentatonic in shape ${box} until it's comfortable, up and down.`,
          `Then play shape ${box + 1} the same way.`,
          `Now go up through shape ${box} and slide into shape ${box + 1} on the G or B string, without stopping.`,
          "Improvise for the last minute, moving freely between the two shapes.",
        ],
        bpm: between(60, 90, 5),
      };
    },
    () => {
      const key = pick(MAJOR_KEYS);
      const string = pick(STRINGS);
      return {
        category: "Scales",
        title: `${key} major on one string`,
        summary: "Learn the scale along the neck instead of across it.",
        steps: [
          `Play the ${key} major scale on the ${string} string only, from the lowest fret you can up past the 12th fret and back.`,
          "Say the scale degrees as you go: 1, 2, 3…",
          "Then improvise a melody using just that string. Slides are encouraged.",
        ],
      };
    },
    () => {
      const [mode, flavor] = pick(MODES);
      const root = pick(["A", "D", "E", "G"]);
      return {
        category: "Scales",
        title: `${root} ${mode} over a drone`,
        summary: `Hear what makes ${mode} sound like itself: ${flavor}.`,
        steps: [
          `Let the open ${root} string ring as a drone.`,
          `Play ${root} ${mode} slowly over it, holding each note for a beat.`,
          `Lean on ${flavor}: land on it, hold it, and notice the colour it adds.`,
          "Spend the last two minutes making short melodies that feature that note.",
        ],
        bpm: 60,
      };
    },
    () => {
      const key = pick(["C", "G", "D", "A", "F"]);
      const kind = pick(["3rds", "6ths"]);
      return {
        category: "Scales",
        title: `${key} major in diatonic ${kind}`,
        summary: "The sweet two-note harmony sound you hear in Motown and country fills.",
        steps: [
          kind === "3rds"
            ? `Play ${key} major as pairs of notes a 3rd apart on the G and B strings, walking up the neck.`
            : `Play ${key} major as pairs of notes a 6th apart on the D and B strings (skip the G), walking up the neck.`,
          "Pick both notes together, then try hybrid picking: pick for the low note, middle finger for the high note.",
          "Slide into each shape from a fret below for a soul feel.",
        ],
      };
    },
  ],
  Arpeggios: [
    () => {
      const chord = pick(["C", "G", "D", "A", "E", "F", "Am", "Em", "Dm"]);
      const set = pick(STRING_SETS);
      return {
        category: "Arpeggios",
        title: `${chord} triads up the neck on ${set}`,
        summary: "Three inversions, three small shapes that connect.",
        steps: [
          `Find root position ${chord} on the ${set} strings, then the 1st and 2nd inversions above it.`,
          "Strum each shape, then arpeggiate it low to high.",
          "Walk the three shapes up the neck and back down without stopping.",
          "Say which note (root, 3rd or 5th) is on top of each shape.",
        ],
        bpm: between(60, 80, 5),
      };
    },
    () => {
      const [quality, formula] = pick(SEVENTHS);
      const root = pick(NATURALS);
      return {
        category: "Arpeggios",
        title: `${root}${quality} arpeggio in two positions`,
        summary: `Chord tones ${formula}.`,
        steps: [
          `Play a ${root}${quality} arpeggio (${formula}) from the root on the low E string, across two octaves.`,
          "Now find it starting from the root on the A string.",
          "Play both up and down as eighth notes, then play it starting from the 3rd instead of the root.",
        ],
        bpm: between(60, 90, 5),
      };
    },
    () => {
      const key = pick(["C", "G", "F", "Bb", "D"]);
      const [ii, , , , V] = SCALE[key];
      return {
        category: "Arpeggios",
        title: `Arpeggiate a ii-V-I in ${key}`,
        summary: "Outline the changes so the chords can be heard without strumming.",
        steps: [
          `The progression is ${ii}7 – ${V}7 – ${key}maj7, one bar each.`,
          "Arpeggiate each chord in one position (around frets 2–5 or 7–10), changing chord on every bar.",
          "Start each bar on the closest chord tone to where the last bar ended, rather than the root.",
        ],
        bpm: between(60, 90, 5),
      };
    },
  ],
  Chords: [
    () => {
      const chord = pick(["C", "A", "G", "E", "D"]);
      return {
        category: "Chords",
        title: `${chord} in all five CAGED shapes`,
        summary: "One chord, five places on the neck.",
        steps: [
          `Play ${chord} using the open C, A, G, E and D shapes, moving each one up the neck.`,
          "Find each shape, strum it, then point out where the root is.",
          "Go through all five shapes up the neck and back down.",
          "Pick one shape you rarely use and play a little progression with it.",
        ],
      };
    },
    () => {
      const pairs = [
        ["C", "G"],
        ["G", "D"],
        ["Am", "F"],
        ["D", "A"],
        ["E", "Am"],
        ["F", "C"],
        ["Bm", "G"],
        ["C", "Am"],
      ] as const;
      const [a, b] = pick(pairs);
      return {
        category: "Chords",
        title: `One-minute changes: ${a} ↔ ${b}`,
        summary: "The fastest way to clean up chord switches.",
        steps: [
          `Start a 1-minute timer and switch between ${a} and ${b} as many times as you can. Strum once per chord and make sure every note rings.`,
          "Count your changes and write the number down.",
          "Rest, then do two more rounds. Try to beat your count.",
          "Finish by playing the change in time at a slow tempo.",
        ],
      };
    },
    () => {
      const key = pick(MAJOR_KEYS);
      const p = progression(key);
      return {
        category: "Chords",
        title: `Barre chords: ${p.name} in ${key}`,
        summary: p.chords,
        steps: [
          `Play ${p.chords} using only E-shape and A-shape barre chords.`,
          "Find a version where you move as little as possible between chords.",
          "Then find a second version in a different area of the neck.",
          "Strum four beats per chord and keep the click going.",
        ],
        bpm: between(70, 100, 5),
      };
    },
    () => {
      const key = pick(["C", "F", "G", "Bb", "D"]);
      const [ii, , , , V] = SCALE[key];
      return {
        category: "Chords",
        title: `Shell voicings: ii-V-I in ${key}`,
        summary: "Root, 3rd and 7th only: the jazz comping essentials.",
        steps: [
          `Play ${ii}7 – ${V}7 – ${key}maj7 using three-note shells: the root on the low E or A string, plus the 3rd and 7th.`,
          "Find one version that starts with the root on the low E string and one that starts on the A string.",
          "Comp with short stabs on beats 2 and 4.",
        ],
        bpm: between(80, 120, 5),
      };
    },
    () => {
      const key = pick(MAJOR_KEYS.slice(0, 6));
      const p = progression(key);
      const pattern = pick(["D - D U - U D U", "D - - U - U D U", "D U D U (all 8ths)", "D - D U D U - U"]);
      return {
        category: "Chords",
        title: `Strumming pattern: ${pattern}`,
        summary: `Over ${p.chords} (${p.name} in ${key}).`,
        steps: [
          `Keep your hand moving down and up on every eighth note, and only hit the strings where the pattern says: ${pattern}.`,
          "Play it on one chord until it feels automatic.",
          `Then play the progression ${p.chords}, one bar per chord.`,
          "Last round: accent beats 2 and 4.",
        ],
        bpm: between(70, 100, 5),
      };
    },
  ],
  Ear: [
    () => {
      const interval = pick(INTERVALS);
      const root = pick(NATURALS);
      return {
        category: "Ear",
        title: `Sing a ${interval}`,
        summary: "Hear it before you play it.",
        steps: [
          `Play ${root}, then sing the note a ${interval} above it.`,
          "Find the note you sang on the guitar and check whether you were right.",
          "Repeat from five different root notes in different places on the neck.",
          `Then do it descending: sing the note a ${interval} below.`,
        ],
      };
    },
    () => {
      const key = pick(MINOR_KEYS);
      return {
        category: "Ear",
        title: "Call and response",
        summary: `Phrase, then echo it somewhere else (${key} minor).`,
        steps: [
          `Play a short two-bar phrase in ${key} minor pentatonic.`,
          "Play it again exactly, but in a different position on the neck.",
          "Then hum a new phrase first and find it on the guitar.",
          "Keep each phrase short enough to remember (3 to 6 notes).",
        ],
      };
    },
    () => {
      const root = pick(["A", "D", "E", "G"]);
      return {
        category: "Ear",
        title: `Scale degrees over a ${root} drone`,
        summary: "Learn what each degree feels like against the root.",
        steps: [
          `Let the open ${root} string ring as a drone.`,
          `Play each note of ${root} major and say its number (1–7) out loud as it sounds against the drone.`,
          "Then play degrees at random with your eyes closed and name them.",
          "Pay special attention to how the 4 and 7 want to resolve.",
        ],
      };
    },
    () => ({
      category: "Ear",
      title: "Learn a riff by ear",
      summary: "Five minutes, no tabs.",
      steps: [
        "Pick a short riff or vocal melody from a song you're working on.",
        "Find the first note by sliding along one string until it matches.",
        "Work out the rest note by note. Sing each one before you look for it.",
        "Once you have it, play it along with the recording.",
      ],
    }),
  ],
  Fretboard: [
    () => {
      const note = pick(NOTES);
      return {
        category: "Fretboard",
        title: `Find every ${note}`,
        summary: "Note-finding against the clock.",
        steps: [
          `Play every ${note} on the low E string, then the A string, and so on up to high E, below the 12th fret.`,
          "Say the note's name as you play it.",
          `Do it again with the click at one ${note} per beat.`,
          "Then do it from high E down to low E.",
        ],
        bpm: between(40, 60, 5),
      };
    },
    () => {
      const note = pick(NOTES);
      return {
        category: "Fretboard",
        title: `${note} octave shapes`,
        summary: "Two shapes that unlock the whole neck.",
        steps: [
          `Play ${note} on the low E string, then its octave two strings up and two frets higher.`,
          "Do the same from the A string. From the D and G strings, the shape shifts up one more fret because of the B string.",
          `Chain the octaves all the way across the neck, so you play every ${note} in order.`,
        ],
      };
    },
    () => {
      const chord = pick(["C", "G", "D", "A", "F", "Am", "Em"]);
      return {
        category: "Fretboard",
        title: `Chord tones of ${chord} on the top three strings`,
        summary: "Know which note is the root, which the 3rd and which the 5th.",
        steps: [
          `Find every ${chord} root, 3rd and 5th on the G, B and high E strings, up to the 12th fret.`,
          "Play only the 3rds and say \"three\" each time.",
          "Then play only the roots, then only the 5ths.",
        ],
      };
    },
  ],
  Rhythm: [
    () => ({
      category: "Rhythm",
      title: "Subdivision ladder",
      summary: "Quarters to 16ths and back without drifting.",
      steps: [
        "Mute the strings with your fretting hand. Play four bars each of quarter notes, eighths, triplets and sixteenths.",
        "Then walk back down the ladder to quarters.",
        "Count out loud: \"1 2 3 4\", then \"1 & 2 &\", then \"1 trip-let\", then \"1 e & a\".",
        "Keep the click steady. It's the subdivision that changes, not the tempo.",
      ],
      bpm: between(60, 80, 5),
    }),
    () => ({
      category: "Rhythm",
      title: "Off-beat upstrokes",
      summary: "Reggae and ska feel: chords only on the \"and\".",
      steps: [
        "Hold a chord and mute it slightly. Move your hand in eighth notes, but only hit the strings on the upstrokes (the \"&\" of each beat).",
        "Keep the stabs short by releasing the fretting-hand pressure right after each one.",
        "Then do two bars of off-beats followed by two bars of normal downbeats.",
      ],
      bpm: between(80, 110, 5),
    }),
    () => ({
      category: "Rhythm",
      title: "7/8 groove: 2+2+3",
      summary: "Get comfortable in an odd meter.",
      steps: [
        "Set the click to 7 beats per bar and count \"1 2, 1 2, 1 2 3\" against it.",
        "Accent the first note of each group with a palm-muted riff on an E or A power chord.",
        "Then try the grouping 3+2+2.",
      ],
      bpm: between(110, 150, 10),
      beats: 7,
    }),
    () => ({
      category: "Rhythm",
      title: "Displace a riff",
      summary: "Same notes, starting on a different beat.",
      steps: [
        "Take a one-bar riff you know.",
        "Play it starting on beat 1, then start it on beat 2, then on the \"&\" of 1.",
        "Keep counting so you know where beat 1 is the whole time.",
      ],
      bpm: between(70, 100, 5),
    }),
  ],
  Improv: [
    () => {
      const key = pick(MINOR_KEYS);
      return {
        category: "Improv",
        title: "Three-note solo",
        summary: `Melody comes from limits (${key} minor).`,
        steps: [
          `Pick any three notes from ${key} minor pentatonic in one position.`,
          "Improvise for two minutes using only those three notes. Vary the rhythm, the dynamics and the bends.",
          "Add one note per minute until you're using the whole box.",
        ],
      };
    },
    () => {
      const vamp = pick([
        ["Am7", "D7", "the C (3rd of Am7) and the F# (3rd of D7)"],
        ["Dm7", "G7", "the F (3rd of Dm7) and the B (3rd of G7)"],
        ["Em7", "A7", "the G (3rd of Em7) and the C# (3rd of A7)"],
        ["Cmaj7", "Fmaj7", "the E (3rd of Cmaj7) and the A (3rd of Fmaj7)"],
      ] as const);
      return {
        category: "Improv",
        title: `Target the 3rds: ${vamp[0]} – ${vamp[1]}`,
        summary: "Make your lines follow the chord changes.",
        steps: [
          `Over a two-bar vamp of ${vamp[0]} to ${vamp[1]} (loop it with a backing track or record yourself), land on ${vamp[2]} at each chord change.`,
          "Start with just those two notes on beat 1, then fill in the space between with scale notes.",
          "Finish by improvising freely, but still landing on a 3rd at every change.",
        ],
        bpm: between(70, 100, 5),
      };
    },
    () => {
      const key = pick(MINOR_KEYS);
      return {
        category: "Improv",
        title: "One rhythm, many notes",
        summary: "Phrase like a singer.",
        steps: [
          "Pick a simple rhythm, e.g. short-short-long.",
          `Improvise in ${key} minor, but every phrase must use that rhythm.`,
          "Change the notes and the position freely. The rhythm stays fixed.",
          "Leave a full bar of silence between phrases.",
        ],
        bpm: between(70, 100, 5),
      };
    },
    () => {
      const string = pick(["B", "G", "high E", "D"]);
      const key = pick(MAJOR_KEYS.slice(0, 6));
      return {
        category: "Improv",
        title: `Solo on the ${string} string only`,
        summary: `Horizontal thinking in ${key} major.`,
        steps: [
          `Improvise in ${key} major using only the ${string} string.`,
          "Use slides, bends and vibrato to make it sing.",
          "Aim each phrase toward a chord tone (the 1, 3 or 5 of the key) at the end.",
        ],
      };
    },
  ],
};

let lastTitle = "";

/** A random task, optionally from one category, never the same title twice in a row. */
export function randomTask(category?: Category): PracticeTask {
  const cats = category ? [category] : CATEGORIES;
  for (let i = 0; i < 20; i++) {
    const t = pick(TEMPLATES[pick(cats)])();
    if (t.title !== lastTitle || i === 19) {
      lastTitle = t.title;
      return { ...t, id: Math.random().toString(36).slice(2) };
    }
  }
  throw new Error("unreachable");
}
