/**
 * Keyword / phrase distress matcher (pure, testable — no native deps).
 *
 * Given a recognized transcript and the user's keyword list, find the strongest
 * distress phrase and return a 0–100 keyword confidence. Matching is tolerant of the
 * spelling variance you get from speech-to-text and Roman-Urdu, e.g. "bachao",
 * "bachaoo", "bachau", "bacha o" all resolve to the same canonical keyword.
 *
 * Confidence blends three real signals — it is NOT a fixed trigger:
 *   • recognizer confidence for the utterance (0–1, when the engine supplies it)
 *   • match quality (exact phrase > word-boundary > fuzzy/edit-distance)
 *   • per-keyword severity (see KEYWORD_SEVERITY)
 */

import { KEYWORD_SEVERITY } from '../config';
import type { KeywordMatch } from '../types';

/** Lowercase, strip punctuation, collapse whitespace and repeated vowels. */
const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z\s]/g, ' ')       // keep letters/spaces only
    .replace(/(.)\1{2,}/g, '$1$1')   // "bachaooo" → "bachaoo"
    .replace(/\s+/g, ' ')
    .trim();

/** Levenshtein distance (small strings only). */
const editDistance = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = tmp;
    }
  }
  return dp[n];
};

/** Fuzzy similarity 0–1 based on normalized edit distance. */
const similarity = (a: string, b: string): number => {
  if (!a.length && !b.length) return 1;
  const dist = editDistance(a, b);
  return 1 - dist / Math.max(a.length, b.length);
};

const severityOf = (keyword: string): number => KEYWORD_SEVERITY[keyword] ?? 0.8;

/**
 * Score a single keyword against a normalized transcript.
 * Returns a match-quality 0–1 (0 = no meaningful match).
 */
const scoreKeyword = (transcript: string, tokens: string[], keyword: string): number => {
  const kw = normalize(keyword);
  if (!kw) return 0;

  // Multi-word phrase: look for it as a contiguous substring (word-boundary aware).
  if (kw.includes(' ')) {
    if (transcript.includes(kw)) return 1;
    // allow small typos across the phrase
    const sim = similarity(transcript.length > 40 ? transcript.slice(0, 40) : transcript, kw);
    return sim >= 0.82 ? sim : 0;
  }

  // Single word: exact token match is strongest.
  if (tokens.includes(kw)) return 1;

  // Otherwise best fuzzy match against any token (handles STT spelling drift).
  let best = 0;
  for (const t of tokens) {
    if (Math.abs(t.length - kw.length) > 3) continue;
    const sim = similarity(t, kw);
    if (sim > best) best = sim;
  }
  // Require a fairly close match to avoid false positives on short words.
  return best >= (kw.length <= 4 ? 0.86 : 0.8) ? best : 0;
};

export interface KeywordMatchInput {
  transcript: string;
  /** Recognizer confidence for this utterance, 0–1. Undefined ⇒ treated as 0.6. */
  recognizerConfidence?: number;
  keywords: string[];
}

/**
 * Find the strongest distress keyword in a transcript.
 * @returns the best {@link KeywordMatch}, or null if nothing crosses the bar.
 */
export const matchKeywords = ({
  transcript,
  recognizerConfidence,
  keywords,
}: KeywordMatchInput): KeywordMatch | null => {
  const norm = normalize(transcript);
  if (!norm) return null;
  const tokens = norm.split(' ');
  const rc = recognizerConfidence == null ? 0.6 : Math.max(0, Math.min(1, recognizerConfidence));

  let best: KeywordMatch | null = null;
  for (const keyword of keywords) {
    const quality = scoreKeyword(norm, tokens, keyword);
    if (quality <= 0) continue;

    const canonical = normalize(keyword);
    const severity = severityOf(canonical);
    // 0–100. Recognizer confidence and match quality gate the ceiling; severity scales
    // it across a wide band so low-severity everyday words (e.g. "stop", 0.55) stay in
    // the MEDIUM/confirm band while strong distress words ("save me", "bachao") reach the
    // HIGH/auto-SOS band. This is a blend of REAL signals, never a fixed trigger.
    const confidence = Math.round(
      Math.min(100, (55 + 40 * rc) * quality * (0.4 + 0.6 * severity))
    );

    if (!best || confidence > best.confidence) {
      best = { phrase: canonical, matchedText: transcript.trim(), confidence, severity };
    }
  }
  return best;
};

// Exposed for unit tests.
export const _internals = { normalize, editDistance, similarity, scoreKeyword };
