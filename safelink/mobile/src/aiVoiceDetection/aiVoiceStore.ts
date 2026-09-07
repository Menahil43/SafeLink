/**
 * AI Voice Detection — module-local reactive state (zustand).
 *
 * Kept separate from the app's global store so the feature stays isolated and easy to
 * remove, while still using the project's existing state-management library (zustand).
 * The controller writes here; React components subscribe via the useAiVoiceDetection
 * hook. The global store's `aiEnabled` / `currentAiEvent` are mirrored by the
 * controller so existing screens keep working.
 */

import { create } from 'zustand';
import type {
  ActiveAlert,
  AcousticAssessment,
  AiVoiceStatus,
  DetectionLogEntry,
  DetectionResult,
} from './types';

interface AiVoiceState {
  /** User intent: has AI Voice Detection been switched on. */
  enabled: boolean;
  /** Live pipeline/status for the UI (ON/OFF/listening + stages). */
  status: AiVoiceStatus;
  /** Human-readable detail for UNAVAILABLE/ERROR states. */
  statusDetail: string | null;

  /** Microphone / speech permission granted. */
  micPermission: 'unknown' | 'granted' | 'denied';
  /** Whether the native speech module is present (false in Expo Go / web). */
  speechAvailable: boolean;
  /** Whether we are receiving acoustic (volume) samples on this platform. */
  acousticAvailable: boolean;

  /** Live loudness 0–1 for the meter animation. */
  currentLevel: number;
  /** Most recent partial/next transcript (for the debug/status readout). */
  lastTranscript: string;
  /** Latest fused result (may be sub-threshold). */
  lastResult: DetectionResult | null;
  lastAcoustic: AcousticAssessment | null;

  /** The alert currently on screen, if any (drives DistressAlertOverlay). */
  activeAlert: ActiveAlert | null;

  /** In-memory recent detections for the control screen (most-recent-first, capped). */
  log: DetectionLogEntry[];

  // ─ setters (used by the controller only) ─────────────────────────────────
  setEnabled: (enabled: boolean) => void;
  setStatus: (status: AiVoiceStatus, detail?: string | null) => void;
  setMicPermission: (p: AiVoiceState['micPermission']) => void;
  setSpeechAvailable: (v: boolean) => void;
  setAcousticAvailable: (v: boolean) => void;
  setCurrentLevel: (level: number) => void;
  setLastTranscript: (t: string) => void;
  setLastResult: (r: DetectionResult | null) => void;
  setLastAcoustic: (a: AcousticAssessment | null) => void;
  setActiveAlert: (a: ActiveAlert | null) => void;
  updateAlertCountdown: (seconds: number) => void;
  addLog: (entry: DetectionLogEntry) => void;
  updateLog: (id: string, patch: Partial<DetectionLogEntry>) => void;
  clearLog: () => void;
}

const MAX_LOG = 50;

export const useAiVoiceStore = create<AiVoiceState>((set) => ({
  enabled: false,
  status: 'OFF',
  statusDetail: null,
  micPermission: 'unknown',
  speechAvailable: false,
  acousticAvailable: false,
  currentLevel: 0,
  lastTranscript: '',
  lastResult: null,
  lastAcoustic: null,
  activeAlert: null,
  log: [],

  setEnabled: (enabled) => set({ enabled }),
  setStatus: (status, detail = null) => set({ status, statusDetail: detail }),
  setMicPermission: (micPermission) => set({ micPermission }),
  setSpeechAvailable: (speechAvailable) => set({ speechAvailable }),
  setAcousticAvailable: (acousticAvailable) => set({ acousticAvailable }),
  setCurrentLevel: (currentLevel) => set({ currentLevel }),
  setLastTranscript: (lastTranscript) => set({ lastTranscript }),
  setLastResult: (lastResult) => set({ lastResult }),
  setLastAcoustic: (lastAcoustic) => set({ lastAcoustic }),
  setActiveAlert: (activeAlert) => set({ activeAlert }),
  updateAlertCountdown: (seconds) =>
    set((s) => (s.activeAlert ? { activeAlert: { ...s.activeAlert, countdownSeconds: seconds } } : {})),
  addLog: (entry) => set((s) => ({ log: [entry, ...s.log].slice(0, MAX_LOG) })),
  updateLog: (id, patch) =>
    set((s) => ({ log: s.log.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
  clearLog: () => set({ log: [] }),
}));
