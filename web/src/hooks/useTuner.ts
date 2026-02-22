import { useState, useRef, useCallback } from "react";
import { detectPitch } from "../utils/pitchDetection";

const NOTE_NAMES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
const BUFFER_SIZE = 4096;
const UPDATE_INTERVAL = 50; // ms — throttle setState to ~20Hz

export interface TunerState {
  listening: boolean;
  note: string | null;
  octave: number | null;
  cents: number | null;
  frequency: number | null;
  clarity: number | null;
  micPermission: "prompt" | "granted" | "denied";
  error: string | null;
  start: () => void;
  stop: () => void;
}

export function useTuner(a4Ref: React.RefObject<number>): TunerState {
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [octave, setOctave] = useState<number | null>(null);
  const [cents, setCents] = useState<number | null>(null);
  const [frequency, setFrequency] = useState<number | null>(null);
  const [clarity, setClarity] = useState<number | null>(null);
  const [micPermission, setMicPermission] = useState<"prompt" | "granted" | "denied">("prompt");
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const bufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const lastUpdateRef = useRef(0);

  // Refs for latest pitch data (written every rAF, read by throttled setState)
  const latestRef = useRef<{
    note: string | null;
    octave: number | null;
    cents: number | null;
    frequency: number | null;
    clarity: number | null;
  }>({ note: null, octave: null, cents: null, frequency: null, clarity: null });

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setListening(false);
    setNote(null);
    setOctave(null);
    setCents(null);
    setFrequency(null);
    setClarity(null);
  }, []);

  const start = useCallback(async () => {
    setError(null);

    // Request mic access
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermission("granted");
    } catch (err) {
      setMicPermission("denied");
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access denied. Please allow mic access and try again."
          : "Could not access microphone.",
      );
      return;
    }
    streamRef.current = stream;

    // Create AudioContext inside user gesture for iOS
    const audioCtx = new AudioContext({ latencyHint: "interactive" });
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = BUFFER_SIZE;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    // Don't connect analyser to destination — no feedback
    analyserRef.current = analyser;

    // Pre-allocate buffer
    bufferRef.current = new Float32Array(BUFFER_SIZE);
    lastUpdateRef.current = 0;

    setListening(true);

    function loop() {
      const a = analyserRef.current;
      const buf = bufferRef.current;
      const ctx = audioCtxRef.current;
      if (!a || !buf || !ctx) return;

      a.getFloatTimeDomainData(buf);
      const result = detectPitch(buf, ctx.sampleRate);

      if (result && result.clarity > 0.8) {
        const a4 = a4Ref.current;
        const semitones = 12 * Math.log2(result.frequency / a4);
        const rounded = Math.round(semitones);
        const centsVal = Math.round((semitones - rounded) * 100);

        // Note index: semitones from A4, wrap into 0–11
        const noteIdx = ((rounded % 12) + 12) % 12;
        // Octave: A4 is octave 4. Notes C and above are +1 octave in music notation.
        const rawOctave = 4 + Math.floor((rounded + 9) / 12);
        // Adjust: A is index 0, so C (index 3) starts the next octave
        const noteOctave = noteIdx >= 3 ? rawOctave : rawOctave;

        latestRef.current = {
          note: NOTE_NAMES[noteIdx],
          octave: noteOctave,
          cents: centsVal,
          frequency: result.frequency,
          clarity: result.clarity,
        };
      } else {
        latestRef.current = {
          note: null,
          octave: null,
          cents: null,
          frequency: null,
          clarity: null,
        };
      }

      // Throttle React state updates to ~20Hz
      const now = performance.now();
      if (now - lastUpdateRef.current >= UPDATE_INTERVAL) {
        lastUpdateRef.current = now;
        const l = latestRef.current;
        setNote(l.note);
        setOctave(l.octave);
        setCents(l.cents);
        setFrequency(l.frequency);
        setClarity(l.clarity);
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [a4Ref, stop]);

  return { listening, note, octave, cents, frequency, clarity, micPermission, error, start, stop };
}
