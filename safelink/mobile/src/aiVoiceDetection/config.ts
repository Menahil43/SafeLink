/**
 * AI Voice Detection — configuration.
 *
 * Effective config is resolved from the signed-in user's saved settings
 * (`user.aiSettings` / `user.emergencyPreferences`, already persisted by the backend)
 * and falls back to safe defaults so the feature works even before a profile is
 * hydrated. Nothing here is hard-coded into detection *decisions* — these are only
 * thresholds and word lists the user can change from the control screen.
 */

import type { AiVoiceConfig, RiskLevel } from './types';
import type { User } from '../store';

/**
 * Default distress keywords. Includes the FR-28 required set plus common Roman-Urdu
 * spellings. Matching is accent/spelling tolerant (see keywordMatcher), so "bachao",
 * "bachaoo", "bachau", "bachao" all resolve to the same canonical phrase.
 */
export const DEFAULT_KEYWORDS = [
  'help',
  'help me',
  'please help',
  'save me',
  'bachao',
  'bachaoo',
  'madad',
  'madad karo',
  'stop',
  'chhoro',
  'leave me',
] as const;

/** Per-keyword distress severity (0–1). Rarer/stronger words weigh more than "stop". */
export const KEYWORD_SEVERITY: Record<string, number> = {
  help: 0.85,
  'help me': 0.95,
  'please help': 1.0,
  'save me': 1.0,
  bachao: 1.0,
  bachaoo: 1.0,
  madad: 0.9,
  'madad karo': 1.0,
  chhoro: 0.85,
  'leave me': 0.85,
  stop: 0.55, // common in everyday speech → weaker signal on its own
};

export const DEFAULTS: AiVoiceConfig = {
  keywords: [...DEFAULT_KEYWORDS],
  keywordLanguages: ['en', 'ur'],
  acousticDetection: true,
  autoEscalateThreshold: 75, // aligns with backend HIGH (≥75)
  warnThreshold: 50,         // aligns with backend MEDIUM (≥50)
  autoEscalate: true,        // FR-28: genuine high-confidence must not require a tap
  countdownSeconds: 5,
  alertCooldownMs: 20_000,
  // Recognizer locale. Overridable via env so a deployment can ship e.g. 'ur-PK' or
  // 'en-IN' without a code change. Falls back to US English.
  lang: process.env.EXPO_PUBLIC_AI_VOICE_LANG || 'en-US',
};

/** Clamp a number into [min, max]. */
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * Build the effective config from the user profile, honoring their saved AI settings
 * where present and otherwise using {@link DEFAULTS}.
 */
export const resolveConfig = (user: User | null): AiVoiceConfig => {
  const ai = user?.aiSettings;
  const prefs = user?.emergencyPreferences;

  const keywords =
    ai?.keywords && ai.keywords.length > 0
      ? ai.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean)
      : DEFAULTS.keywords;

  // The user's confidenceThreshold is the auto-escalation line (backend default 75).
  const autoEscalateThreshold = clamp(
    ai?.confidenceThreshold ?? DEFAULTS.autoEscalateThreshold,
    50,
    100
  );

  return {
    keywords,
    keywordLanguages: DEFAULTS.keywordLanguages,
    acousticDetection: ai?.acousticDetection ?? DEFAULTS.acousticDetection,
    autoEscalateThreshold,
    warnThreshold: Math.min(DEFAULTS.warnThreshold, autoEscalateThreshold - 1),
    // If the user has explicitly opted out of auto-activation, respect it; otherwise
    // default to true per FR-28. (Backend field defaults to false, so treat only an
    // explicit `false` as opt-out.)
    autoEscalate: prefs?.aiAutoActivate ?? DEFAULTS.autoEscalate,
    // Keep the distress countdown short even if the (unrelated) safety-timer escalation
    // delay is large. Clamp to a sane 3–15s window.
    countdownSeconds: clamp(DEFAULTS.countdownSeconds, 3, 15),
    alertCooldownMs: DEFAULTS.alertCooldownMs,
    lang: DEFAULTS.lang,
  };
};

/**
 * Map an overall 0–100 confidence to the backend-compatible risk level.
 * Mirrors the server's mapping in ai.routes.ts so client and server agree.
 */
export const riskFromConfidence = (confidence: number): RiskLevel => {
  if (confidence >= 90) return 'CRITICAL';
  if (confidence >= 75) return 'HIGH';
  if (confidence >= 50) return 'MEDIUM';
  return 'LOW';
};
