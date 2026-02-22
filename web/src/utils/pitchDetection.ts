/**
 * YIN pitch detection algorithm.
 *
 * Returns the detected fundamental frequency and a clarity score (0–1),
 * or null when no clear pitch is found.
 */

const YIN_THRESHOLD = 0.15;
const MIN_FREQUENCY = 60; // Hz — low B on a bass
const MAX_FREQUENCY = 1200; // Hz — high guitar harmonics

export interface PitchResult {
  frequency: number;
  clarity: number;
}

export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
): PitchResult | null {
  const halfLen = Math.floor(buffer.length / 2);
  const minTau = Math.floor(sampleRate / MAX_FREQUENCY);
  const maxTau = Math.min(halfLen, Math.floor(sampleRate / MIN_FREQUENCY));

  if (maxTau <= minTau) return null;

  // Step 1: Difference function
  const diff = new Float32Array(maxTau);
  for (let tau = minTau; tau < maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < halfLen; i++) {
      const d = buffer[i] - buffer[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Step 2: Cumulative mean normalized difference
  const cmndf = new Float32Array(maxTau);
  cmndf[minTau] = 1;
  let runningSum = diff[minTau];
  for (let tau = minTau + 1; tau < maxTau; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = diff[tau] * (tau - minTau + 1) / runningSum;
  }

  // Step 3: Absolute threshold — find first tau below threshold
  let bestTau = -1;
  for (let tau = minTau + 1; tau < maxTau; tau++) {
    if (cmndf[tau] < YIN_THRESHOLD) {
      // Walk forward to find the local minimum in this dip
      while (tau + 1 < maxTau && cmndf[tau + 1] < cmndf[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  if (bestTau === -1) return null;

  // Step 4: Parabolic interpolation for sub-sample accuracy
  let betterTau = bestTau;
  if (bestTau > minTau && bestTau + 1 < maxTau) {
    const s0 = cmndf[bestTau - 1];
    const s1 = cmndf[bestTau];
    const s2 = cmndf[bestTau + 1];
    const denom = 2 * s1 - s2 - s0;
    if (denom !== 0) {
      betterTau = bestTau + (s0 - s2) / (2 * denom);
    }
  }

  const frequency = sampleRate / betterTau;
  const clarity = 1 - (cmndf[bestTau] || 0);

  if (frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) return null;

  return { frequency, clarity };
}
