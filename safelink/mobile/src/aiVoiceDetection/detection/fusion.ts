/**
 * Detection fusion (pure).
 *
 * Combines the keyword result and the acoustic assessment into a single
 * {@link DetectionResult} with an overall 0–100 confidence, a backend-compatible
 * detection type, and a risk level. Corroboration between the two channels boosts
 * confidence; acoustic-only signals are capped because loudness alone is a weaker
 * indicator than a recognized distress phrase.
 */

import { riskFromConfidence } from '../config';
import type {
  AcousticAssessment,
  DetectionResult,
  DetectionType,
  KeywordMatch,
} from '../types';

/**
 * Acoustic-only confidence is capped BELOW the default auto-escalation threshold (75).
 * Loudness alone can't reliably tell a scream from constant-loud music, so a scream on
 * its own raises a MEDIUM warning the user confirms — it never silently auto-triggers
 * SOS. Auto-SOS requires a recognized keyword or keyword+acoustic corroboration. Drop in
 * a real audio ML classifier (see acousticAnalyzer docs) to unlock acoustic-only HIGH.
 */
const ACOUSTIC_ONLY_CAP = 74;

export interface FuseInput {
  keyword: KeywordMatch | null;
  acoustic: AcousticAssessment | null;
  transcript?: string;
  at?: number;
}

/**
 * Fuse the two channels. Returns null when neither channel produced a usable signal.
 */
export const fuse = ({ keyword, acoustic, transcript, at }: FuseInput): DetectionResult | null => {
  const now = at ?? Date.now();
  const k = keyword?.confidence ?? 0;
  const a = acoustic && acoustic.available ? acoustic.confidence : 0;

  if (k <= 0 && a <= 0) return null;

  let confidence: number;
  let detectionType: DetectionType;

  if (k > 0 && a > 0) {
    // Both channels agree → strongest signal. Take the max and add a corroboration
    // bonus scaled by the weaker channel.
    confidence = Math.min(100, Math.round(Math.max(k, a) + 0.4 * Math.min(k, a)));
    detectionType = 'COMBINED';
  } else if (k > 0) {
    confidence = k;
    detectionType = 'KEYWORD';
  } else {
    confidence = Math.min(ACOUSTIC_ONLY_CAP, a);
    detectionType = acoustic?.kind === 'SCREAM' ? 'SCREAM' : 'DISTRESS_AUDIO';
  }

  return {
    detectionType,
    detectedPhrase: keyword?.phrase,
    rawTranscript: transcript,
    confidence,
    keywordConfidence: k > 0 ? k : undefined,
    acousticConfidence: a > 0 ? a : undefined,
    riskLevel: riskFromConfidence(confidence),
    at: now,
  };
};
