/**
 * Acoustic distress analyzer (scream / shout / sudden high-volume vocalization).
 *
 * The microphone stream is provided by expo-speech-recognition, which emits periodic
 * `volumechange` samples on a roughly -2 … 10 scale (higher = louder). We keep a short
 * rolling window of those samples and derive a REAL loudness signal — sustained high
 * energy and sudden spikes — as a practical, production-compatible proxy for
 * screaming/shouting. No timers or random values are involved; if the platform gives
 * us no volume samples, the analyzer honestly reports `available: false` and
 * contributes nothing (keyword detection still runs).
 *
 * True scream-vs-music classification requires an audio ML model. That is abstracted
 * behind {@link AcousticClassifier}: the default {@link HeuristicClassifier} uses the
 * loudness envelope, and a YAMNet/TFLite model or a cloud audio-classification API can
 * be dropped in without touching the rest of the module (see README / env docs).
 */

import type { AcousticAssessment } from '../types';

/** Raw volume sample from the recognizer, normalized to 0–1 loudness. */
export interface VolumeSample {
  at: number;   // epoch ms
  level: number; // 0–1 (see normalizeVolume)
}

/** Pluggable classifier contract. Implementations return 0–100 confidence. */
export interface AcousticClassifier {
  readonly name: string;
  /**
   * Assess a rolling window of loudness samples.
   * @param window most-recent-last samples (bounded to ~WINDOW_MS)
   */
  assess(window: VolumeSample[]): AcousticAssessment;
}

// The recognizer's `volumechange` value scale (jamsch/expo-speech-recognition):
// roughly -2 (silence) … 10 (very loud). We map that to 0–1.
const VOL_MIN = -2;
const VOL_MAX = 10;

/** Normalize a raw recognizer volume value to 0–1 loudness. */
export const normalizeVolume = (raw: number): number => {
  const v = (raw - VOL_MIN) / (VOL_MAX - VOL_MIN);
  return Math.max(0, Math.min(1, v));
};

/** Loudness at/above this (0–1) counts as shouting/screaming energy. */
const SCREAM_LEVEL = 0.72;
/** Loudness must stay above SCREAM_LEVEL at least this long to be "sustained". */
const SUSTAIN_MS = 450;
/** A single very loud spike at/above this level is treated as a scream burst. */
const SPIKE_LEVEL = 0.9;

/**
 * Default heuristic classifier — envelope based. Produces higher confidence when the
 * signal is both loud AND sustained (a scream), a lower-but-nonzero confidence for
 * brief loud bursts, and 0 for normal conversation / quiet audio.
 */
export class HeuristicClassifier implements AcousticClassifier {
  readonly name = 'heuristic-envelope';

  assess(window: VolumeSample[]): AcousticAssessment {
    if (window.length === 0) {
      return { confidence: 0, kind: 'NONE', peakLevel: 0, sustainedMs: 0, available: false };
    }

    let peak = 0;
    let sustainedMs = 0;
    let runStart: number | null = null;
    let maxRun = 0;

    for (const s of window) {
      if (s.level > peak) peak = s.level;
      if (s.level >= SCREAM_LEVEL) {
        if (runStart == null) runStart = s.at;
        maxRun = Math.max(maxRun, s.at - runStart);
      } else {
        runStart = null;
      }
    }
    sustainedMs = maxRun;

    // Baseline (median-ish) level of the window to reject uniformly loud sources
    // (music/video played at a constant high volume) vs. a sudden vocal outburst.
    const sorted = [...window].map((s) => s.level).sort((a, b) => a - b);
    const baseline = sorted[Math.floor(sorted.length / 2)];
    const dynamicRange = peak - baseline; // outbursts have a large jump over baseline

    let confidence = 0;
    let kind: AcousticAssessment['kind'] = 'NONE';

    if (peak >= SPIKE_LEVEL || (peak >= SCREAM_LEVEL && sustainedMs >= SUSTAIN_MS)) {
      // Loudness component (0–70) + sustain component (0–25).
      const loud = Math.min(70, ((peak - SCREAM_LEVEL) / (1 - SCREAM_LEVEL)) * 70);
      const sustain = Math.min(25, (sustainedMs / 1200) * 25);
      // Dynamic range separates a vocal OUTBURST (rises well above its own baseline)
      // from a uniformly loud source like music/video played at constant volume. A low
      // range damps confidence, but never zeroes it: a sustained loud sound still earns
      // at least a MEDIUM warning the user can dismiss (it must NOT silently auto-SOS —
      // that is what ACOUSTIC_ONLY_CAP in fusion enforces).
      const dynFactor = 0.7 + 0.3 * Math.min(1, dynamicRange / 0.3);
      confidence = Math.round(Math.min(100, (loud + sustain) * dynFactor));
      kind = sustainedMs >= SUSTAIN_MS ? 'SCREAM' : 'DISTRESS_AUDIO';
    }

    return { confidence, kind, peakLevel: peak, sustainedMs, available: true };
  }
}

/**
 * Rolling window of loudness samples with an attached classifier. The controller feeds
 * `push()` from recognizer `volumechange` events and reads `assess()` to fuse with
 * keyword detection.
 */
export class AcousticAnalyzer {
  private window: VolumeSample[] = [];
  private readonly windowMs: number;
  private classifier: AcousticClassifier;
  private sawAnySample = false;

  constructor(classifier: AcousticClassifier = new HeuristicClassifier(), windowMs = 1500) {
    this.classifier = classifier;
    this.windowMs = windowMs;
  }

  /** Swap in a different classifier (e.g. a TFLite/YAMNet or cloud-backed one). */
  setClassifier(classifier: AcousticClassifier): void {
    this.classifier = classifier;
  }

  /** Feed one raw recognizer volume value. */
  push(rawLevel: number, at: number = Date.now()): void {
    this.sawAnySample = true;
    this.window.push({ at, level: normalizeVolume(rawLevel) });
    const cutoff = at - this.windowMs;
    while (this.window.length && this.window[0].at < cutoff) this.window.shift();
  }

  /** Current assessment over the rolling window. */
  assess(): AcousticAssessment {
    const result = this.classifier.assess(this.window);
    // If we've genuinely never received a sample, mark unavailable regardless of
    // classifier defaults — this drives the honest "acoustic unavailable" UI state.
    if (!this.sawAnySample) return { ...result, available: false };
    return result;
  }

  reset(): void {
    this.window = [];
    this.sawAnySample = false;
  }

  get hasSignal(): boolean {
    return this.sawAnySample;
  }
}
