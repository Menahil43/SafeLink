/**
 * AI Voice Detection (FR-28) — module types.
 *
 * This module is intentionally self-contained. It consumes a single microphone
 * stream (via expo-speech-recognition) and produces distress *detections* which are
 * routed to the app's existing Emergency Engine. It never creates its own SOS,
 * contacts, notification or location systems.
 *
 * Detection pipeline / state machine (mirrors the FR-28 flow):
 *   OFF → STARTING → LISTENING → DETECTING → EVALUATING → ALERTING → ESCALATING
 * with COOLDOWN, UNAVAILABLE and ERROR as supporting states.
 */

/** Backend-compatible detection type (matches AiDetectionEvent.model / ai.routes). */
export type DetectionType = 'KEYWORD' | 'SCREAM' | 'DISTRESS_AUDIO' | 'COMBINED';

/** Backend-compatible risk level (matches the server confidence→risk mapping). */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Backend-compatible action recorded against a detection event. */
export type AiActionTaken = 'ALERT_SHOWN' | 'SOS_ACTIVATED' | 'CANCELLED' | 'IGNORED';

/** High-level runtime status shown in the UI (ON/OFF/listening + pipeline stages). */
export type AiVoiceStatus =
  | 'OFF'          // detection disabled
  | 'STARTING'     // acquiring mic / starting recognizer
  | 'LISTENING'    // armed, streaming audio, nothing suspicious
  | 'DETECTING'    // a candidate signal is forming (partial keyword / rising volume)
  | 'EVALUATING'   // scoring a finalized candidate
  | 'ALERTING'     // an alert/countdown is on screen
  | 'ESCALATING'   // auto-triggering the emergency
  | 'COOLDOWN'     // suppressing repeat alerts right after one fired
  | 'UNAVAILABLE'  // native speech module not present (e.g. Expo Go / web)
  | 'ERROR';       // recognizer error (will attempt to self-heal)

/** A keyword match produced by the keyword matcher. */
export interface KeywordMatch {
  phrase: string;          // the canonical keyword that matched
  matchedText: string;     // the raw text span that matched
  /** 0–100 keyword confidence (recognizer confidence × match quality × severity). */
  confidence: number;
  severity: number;        // 0–1 how strongly this word implies distress
}

/** An acoustic (loudness/scream) assessment produced by the acoustic analyzer. */
export interface AcousticAssessment {
  /** 0–100 acoustic distress confidence. 0 when metering is unavailable. */
  confidence: number;
  kind: 'SCREAM' | 'DISTRESS_AUDIO' | 'NONE';
  peakLevel: number;       // normalized 0–1 peak loudness in the window
  sustainedMs: number;     // how long loudness stayed above the scream threshold
  available: boolean;      // false when the platform gives no volume signal
}

/** The fused result the controller acts on. */
export interface DetectionResult {
  detectionType: DetectionType;
  detectedPhrase?: string;
  rawTranscript?: string;
  confidence: number;      // 0–100 overall
  keywordConfidence?: number;
  acousticConfidence?: number;
  riskLevel: RiskLevel;
  at: number;              // epoch ms
}

/** Kind of alert currently presented to the user. */
export type AlertKind = 'HIGH' | 'MEDIUM';

/** The alert state the overlay renders. */
export interface ActiveAlert {
  kind: AlertKind;
  result: DetectionResult;
  eventId: string | null;  // backend AiDetectionEvent id (once logged)
  countdownSeconds: number; // remaining seconds (HIGH only; 0 for MEDIUM)
}

/** Resolved, effective configuration for a detection session. */
export interface AiVoiceConfig {
  keywords: string[];
  keywordLanguages: string[];
  acousticDetection: boolean;
  /** overall confidence ≥ this ⇒ HIGH path: auto countdown → SOS. */
  autoEscalateThreshold: number;
  /** overall confidence in [warnThreshold, autoEscalateThreshold) ⇒ MEDIUM warning. */
  warnThreshold: number;
  /** whether the HIGH path auto-activates SOS (vs. requiring a manual tap). */
  autoEscalate: boolean;
  /** seconds the user has to cancel before automatic SOS on the HIGH path. */
  countdownSeconds: number;
  /** ms to suppress new alerts after one fires (debounce/anti-spam). */
  alertCooldownMs: number;
  /** primary recognizer locale. */
  lang: string;
}

/** A concise log line kept in-memory for the control screen (most-recent-first). */
export interface DetectionLogEntry {
  id: string;
  at: number;
  detectionType: DetectionType;
  detectedPhrase?: string;
  confidence: number;
  riskLevel: RiskLevel;
  action: AiActionTaken;
  synced: boolean;         // whether it reached the backend
}
