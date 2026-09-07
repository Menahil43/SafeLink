/**
 * AI Voice Detection (FR-28) — public module surface.
 *
 * Everything the rest of the app needs is re-exported here, so integration touches
 * exactly one import path and the module stays easy to reason about (or remove):
 *
 *   import {
 *     AiVoiceDetectionScreen,   // the control screen behind the Home "AI Detection" card
 *     DistressAlertOverlay,     // mount ONCE at the app root (floats over every screen)
 *     useAiVoiceDetection,      // hook for any custom UI
 *     aiVoiceController,        // singleton: enable()/disable() on login/logout
 *   } from './aiVoiceDetection';
 */

export { default as AiVoiceDetectionScreen } from './screens/AiVoiceDetectionScreen';
export { default as DistressAlertOverlay } from './components/DistressAlertOverlay';
export { useAiVoiceDetection } from './useAiVoiceDetection';
export { aiVoiceController } from './AiVoiceDetectionController';
export { useAiVoiceStore } from './aiVoiceStore';
export { DEFAULT_KEYWORDS, DEFAULTS, resolveConfig, riskFromConfidence } from './config';
export type {
  AiVoiceConfig,
  AiVoiceStatus,
  DetectionResult,
  DetectionType,
  RiskLevel,
  ActiveAlert,
  AlertKind,
  DetectionLogEntry,
} from './types';
