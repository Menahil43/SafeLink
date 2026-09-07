import { create } from 'zustand';
import type { EmergencyPhase, TimerPhase } from '../emergency/types';

// ─── Types ────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  profileImage?: string;
  emergencyPreferences?: {
    autoEscalate: boolean;
    escalationDelaySeconds: number;
    aiAutoActivate: boolean;
    aiConfidenceThreshold: number;
    locationUpdateIntervalNormal: number;
    locationUpdateIntervalEmergency: number;
  };
  aiSettings?: {
    enabled: boolean;
    keywords: string[];
    acousticDetection: boolean;
    confidenceThreshold: number;
  };
  privacySettings?: {
    shareLocation: boolean;
    shareRecordings: boolean;
  };
}

export interface TrustedContact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  relationship: string;
  priority: number;
  status: 'active' | 'inactive';
  avatarColor: string;
}

export interface Emergency {
  id: string;
  type: string;
  status: 'activating' | 'active' | 'resolved' | 'cancelled' | 'escalated';
  riskLevel: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  currentLatitude?: number;
  currentLongitude?: number;
  currentAddress?: string;
  notifiedContacts: number;
  recording?: {
    id: string;
    uploadStatus: string;
    durationSeconds?: number;
  } | null;
}

export type RecordingStatus = 'idle' | 'not_started' | 'requesting_permission' | 'permission_denied' | 'recording' | 'uploading' | 'waiting_network' | 'finalizing' | 'completed' | 'failed';

export interface Journey {
  id: string;
  origin: { address: string; latitude: number; longitude: number };
  destination: { address: string; latitude: number; longitude: number };
  travelMode: string;
  distanceMeters: number;
  expectedDurationSeconds: number;
  expectedEta: string;
  routePolyline?: string;
  status: string;
}

export interface SafetyTimer {
  id: string;
  status: string;
  durationSeconds: number;
  /** Server timestamp the timer was started — countdown is derived, never a local counter. */
  startedAt: string;
  /** Server timestamp the countdown reaches zero (check-in required). */
  expiryTime: string;
  responseGracePeriodSeconds: number;
  /** Server timestamp escalation fires if no check-in (expiry + grace). */
  escalateAt: string;
  note?: string;
  destination?: string;
  emergencyId?: string;
}

export interface AiDetectionEvent {
  id: string;
  detectedPhrase?: string;
  detectionType: string;
  confidence: number;
  riskLevel: string;
  actionTaken: string;
}

// ─── Store ────────────────────────────────────────────────────────────────
interface SafeLinkStore {
  // Auth
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;

  // Contacts
  contacts: TrustedContact[];
  setContacts: (contacts: TrustedContact[]) => void;
  addContact: (contact: TrustedContact) => void;
  removeContact: (id: string) => void;

  // Emergency
  activeEmergency: Emergency | null;
  setActiveEmergency: (emergency: Emergency | null) => void;
  updateEmergency: (update: Partial<Emergency>) => void;
  recordingStatus: RecordingStatus;
  recordingDurationSeconds: number;
  recordingUploadedChunks: number;
  recordingError: string | null;
  setRecordingState: (state: Partial<Pick<SafeLinkStore, 'recordingStatus' | 'recordingDurationSeconds' | 'recordingUploadedChunks' | 'recordingError'>>) => void;

  // Emergency Engine runtime state
  emergencyPhase: EmergencyPhase;
  setEmergencyPhase: (phase: EmergencyPhase) => void;
  emergencyError: string | null;
  setEmergencyError: (error: string | null) => void;
  /** Epoch ms of the last location point successfully sent to the backend. */
  lastLocationUpdateAt: number | null;
  setLastLocationUpdateAt: (ts: number | null) => void;
  /** Whether the device is currently providing a GPS fix for this emergency. */
  locationAvailable: boolean;
  setLocationAvailable: (available: boolean) => void;

  // Journey
  activeJourney: Journey | null;
  setActiveJourney: (journey: Journey | null) => void;

  // Safety Timer
  activeTimer: SafetyTimer | null;
  setActiveTimer: (timer: SafetyTimer | null) => void;
  /** Safety Timer lifecycle phase (drives the check-in takeover / countdown UI). */
  timerPhase: TimerPhase;
  setTimerPhase: (phase: TimerPhase) => void;
  timerError: string | null;
  setTimerError: (error: string | null) => void;

  // AI Detection
  aiEnabled: boolean;
  setAiEnabled: (enabled: boolean) => void;
  currentAiEvent: AiDetectionEvent | null;
  setCurrentAiEvent: (event: AiDetectionEvent | null) => void;

  // App state
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;
}

export const useStore = create<SafeLinkStore>((set) => ({
  // Auth
  user: null,
  isAuthenticated: false,
  setUser: (user) => set({ user, isAuthenticated: !!user }),

  // Contacts
  contacts: [],
  setContacts: (contacts) => set({ contacts }),
  addContact: (contact) => set((state) => ({ contacts: [...state.contacts, contact] })),
  removeContact: (id) => set((state) => ({ contacts: state.contacts.filter((c) => c.id !== id) })),

  // Emergency
  activeEmergency: null,
  setActiveEmergency: (emergency) => set({ activeEmergency: emergency }),
  updateEmergency: (update) =>
    set((state) => ({
      activeEmergency: state.activeEmergency ? { ...state.activeEmergency, ...update } : null,
    })),
  recordingStatus: 'idle',
  recordingDurationSeconds: 0,
  recordingUploadedChunks: 0,
  recordingError: null,
  setRecordingState: (state) => set(state),

  // Emergency Engine runtime state
  emergencyPhase: 'IDLE',
  setEmergencyPhase: (emergencyPhase) => set({ emergencyPhase }),
  emergencyError: null,
  setEmergencyError: (emergencyError) => set({ emergencyError }),
  lastLocationUpdateAt: null,
  setLastLocationUpdateAt: (lastLocationUpdateAt) => set({ lastLocationUpdateAt }),
  locationAvailable: false,
  setLocationAvailable: (locationAvailable) => set({ locationAvailable }),

  // Journey
  activeJourney: null,
  setActiveJourney: (journey) => set({ activeJourney: journey }),

  // Safety Timer
  activeTimer: null,
  setActiveTimer: (timer) => set({ activeTimer: timer }),
  timerPhase: 'NONE',
  setTimerPhase: (timerPhase) => set({ timerPhase }),
  timerError: null,
  setTimerError: (timerError) => set({ timerError }),

  // AI Detection
  aiEnabled: true,
  setAiEnabled: (enabled) => set({ aiEnabled: enabled }),
  currentAiEvent: null,
  setCurrentAiEvent: (event) => set({ currentAiEvent: event }),

  // App state
  isOnline: true,
  setIsOnline: (online) => set({ isOnline: online }),
}));
