import { useState, useRef, useCallback, useEffect } from "react";

export interface MetronomeState {
  playing: boolean;
  bpm: number;
  beatsPerMeasure: number;
  currentBeat: number; // 1-indexed, 0 when stopped
  start: () => void;
  stop: () => void;
  toggle: () => void;
  setBpm: (bpm: number) => void;
  setBeatsPerMeasure: (beats: number) => void;
  tap: () => void;
}

const MIN_BPM = 30;
const MAX_BPM = 300;

function clampBpm(bpm: number): number {
  return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm)));
}

// Generate a short click sound buffer
function createClickBuffer(
  ctx: AudioContext,
  frequency: number,
  duration: number,
  gain: number,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 40); // fast decay
    data[i] = Math.sin(2 * Math.PI * frequency * t) * envelope * gain;
  }
  return buffer;
}

export function useMetronome(): MetronomeState {
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpmState] = useState(120);
  const [beatsPerMeasure, setBeatsPerMeasureState] = useState(4);
  const [currentBeat, setCurrentBeat] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const accentBufferRef = useRef<AudioBuffer | null>(null);
  const normalBufferRef = useRef<AudioBuffer | null>(null);
  const nextBeatTimeRef = useRef(0);
  const currentBeatRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const bpmRef = useRef(bpm);
  const beatsPerMeasureRef = useRef(beatsPerMeasure);
  const playingRef = useRef(false);

  // Tap tempo state
  const tapTimesRef = useRef<number[]>([]);

  const ensureAudioContext = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
      accentBufferRef.current = createClickBuffer(ctxRef.current, 1200, 0.05, 0.8);
      normalBufferRef.current = createClickBuffer(ctxRef.current, 800, 0.04, 0.5);
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const scheduleClick = useCallback(
    (time: number, isAccent: boolean) => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const buffer = isAccent
        ? accentBufferRef.current
        : normalBufferRef.current;
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(time);
    },
    [],
  );

  const scheduler = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !playingRef.current) return;

    // Schedule clicks ahead by 100ms for smooth timing
    const lookahead = 0.1;
    while (nextBeatTimeRef.current < ctx.currentTime + lookahead) {
      const beatInMeasure =
        (currentBeatRef.current % beatsPerMeasureRef.current) + 1;
      scheduleClick(nextBeatTimeRef.current, beatInMeasure === 1);
      setCurrentBeat(beatInMeasure);
      currentBeatRef.current++;
      const secondsPerBeat = 60.0 / bpmRef.current;
      nextBeatTimeRef.current += secondsPerBeat;
    }
  }, [scheduleClick]);

  const startScheduler = useCallback(() => {
    if (timerRef.current !== null) return;
    const tick = () => {
      scheduler();
      if (playingRef.current) {
        timerRef.current = window.setTimeout(tick, 25);
      }
    };
    tick();
  }, [scheduler]);

  const stop = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    setCurrentBeat(0);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    const ctx = ensureAudioContext();
    playingRef.current = true;
    currentBeatRef.current = 0;
    nextBeatTimeRef.current = ctx.currentTime;
    setPlaying(true);
    startScheduler();
  }, [ensureAudioContext, startScheduler]);

  const toggle = useCallback(() => {
    if (playingRef.current) {
      stop();
    } else {
      start();
    }
  }, [start, stop]);

  const setBpm = useCallback((newBpm: number) => {
    const clamped = clampBpm(newBpm);
    bpmRef.current = clamped;
    setBpmState(clamped);
  }, []);

  const setBeatsPerMeasure = useCallback((beats: number) => {
    const clamped = Math.max(1, Math.min(12, beats));
    beatsPerMeasureRef.current = clamped;
    setBeatsPerMeasureState(clamped);
  }, []);

  const tap = useCallback(() => {
    const now = performance.now();
    const taps = tapTimesRef.current;

    // Reset if last tap was more than 2 seconds ago
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
      tapTimesRef.current = [];
    }

    tapTimesRef.current.push(now);

    // Keep last 8 taps
    if (tapTimesRef.current.length > 8) {
      tapTimesRef.current = tapTimesRef.current.slice(-8);
    }

    if (tapTimesRef.current.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < tapTimesRef.current.length; i++) {
        intervals.push(tapTimesRef.current[i] - tapTimesRef.current[i - 1]);
      }
      const avgInterval =
        intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const newBpm = clampBpm(60000 / avgInterval);
      bpmRef.current = newBpm;
      setBpmState(newBpm);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      playingRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      if (ctxRef.current) {
        ctxRef.current.close();
        ctxRef.current = null;
      }
    };
  }, []);

  return {
    playing,
    bpm,
    beatsPerMeasure,
    currentBeat,
    start,
    stop,
    toggle,
    setBpm,
    setBeatsPerMeasure,
    tap,
  };
}

export { MIN_BPM, MAX_BPM };
