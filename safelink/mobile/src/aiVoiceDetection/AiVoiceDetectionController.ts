/**
 * AI Voice Detection Controller (FR-28) — singleton orchestrator.
 *
 * Owns the detection lifecycle independent of any screen, so monitoring continues as
 * the user navigates. It wires the speech adapter + acoustic analyzer into the fusion
 * scorer, runs the FR-28 state machine, applies cooldown/debounce, drives the on-screen
 * alert + countdown, and routes confirmed/automatic distress to the EXISTING Emergency
 * Engine (`emergencyEngine.activate({ source: 'AI_DETECTION' })`). It never creates a
 * parallel SOS/contacts/notification/location system.
 *
 * Reliability: duplicate SOS is prevented (engine + local guards), the recognizer
 * self-heals on end/error, and all native calls are guarded so manual SOS keeps working
 * even if detection fails.
 */

import { useStore } from '../store';
import { emergencyEngine } from '../emergency/EmergencyEngine';
import { aiAPI } from '../services/api';
import { presentLocalNotification } from '../services/notifications.service';
import { resolveConfig } from './config';
import { matchKeywords } from './detection/keywordMatcher';
import { AcousticAnalyzer } from './detection/acousticAnalyzer';
import { fuse } from './detection/fusion';
import { SpeechAdapter } from './detection/speechAdapter';
import { useAiVoiceStore } from './aiVoiceStore';
import type { AiVoiceConfig, DetectionResult, DetectionLogEntry, AiActionTaken } from './types';

const store = () => useAiVoiceStore.getState();
const app = () => useStore.getState();

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

class AiVoiceDetectionController {
  private speech = new SpeechAdapter();
  private acoustic = new AcousticAnalyzer();
  private config: AiVoiceConfig = resolveConfig(null);

  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private levelDecayTimer: ReturnType<typeof setInterval> | null = null;

  private cooldownUntil = 0;
  private escalating = false;
  private lastAcousticEvalAt = 0;
  private wantRunning = false; // desired state; drives auto-restart

  // ─── PLACEHOLDER_METHODS ───

  /** Whether the current build can actually run detection (native module present). */
  isSupported(): boolean {
    return this.speech.isAvailable();
  }

  /** Turn AI Voice Detection ON. Requests permission and starts continuous listening. */
  async enable(): Promise<void> {
    this.config = resolveConfig(app().user);
    store().setEnabled(true);
    app().setAiEnabled(true);

    if (!this.speech.isAvailable()) {
      store().setSpeechAvailable(false);
      store().setStatus(
        'UNAVAILABLE',
        'Voice detection needs a development build (the speech module isn’t included in Expo Go / web). Manual SOS still works.'
      );
      return;
    }
    store().setSpeechAvailable(true);
    store().setStatus('STARTING');

    const granted = await this.speech.requestPermissions();
    store().setMicPermission(granted ? 'granted' : 'denied');
    if (!granted) {
      store().setStatus('ERROR', 'Microphone / speech permission denied. Enable it in Settings to use voice detection.');
      return;
    }

    this.wantRunning = true;
    this.acoustic.reset();
    this.startLevelDecay();
    this.startRecognition();
  }

  /** Turn AI Voice Detection OFF and tear everything down. */
  async disable(): Promise<void> {
    this.wantRunning = false;
    this.clearCountdown();
    this.clearRestart();
    this.stopLevelDecay();
    this.speech.stop();
    this.acoustic.reset();
    store().setEnabled(false);
    store().setActiveAlert(null);
    store().setCurrentLevel(0);
    store().setStatus('OFF');
    app().setAiEnabled(false);
  }

  /** (Re)start the underlying recognizer with the current config. */
  private startRecognition(): void {
    if (!this.wantRunning) return;
    this.speech.start(
      {
        lang: this.config.lang,
        contextualStrings: this.config.keywords,
        volumeIntervalMs: 250,
      },
      {
        onStart: () => this.setListeningStatus(),
        onResult: (e) => this.handleResult(e.transcript, e.confidence, e.isFinal),
        onVolume: (raw) => this.handleVolume(raw),
        onError: (code, message) => this.handleError(code, message),
        onEnd: () => this.handleEnd(),
      }
    );
  }

  private setListeningStatus(): void {
    const s = store();
    if (s.activeAlert || this.escalating) return;
    if (Date.now() < this.cooldownUntil) s.setStatus('COOLDOWN');
    else s.setStatus('LISTENING');
  }

  // ─── Sensor handlers ───────────────────────────────────────────────────────

  private handleVolume(raw: number): void {
    this.acoustic.push(raw);
    const assessment = this.acoustic.assess();
    store().setAcousticAvailable(assessment.available);
    store().setLastAcoustic(assessment);
    store().setCurrentLevel(assessment.peakLevel);

    if (!this.config.acousticDetection || !this.canAlert()) return;

    // Acoustic-only path (e.g. a scream with no recognizable words). Throttled.
    const now = Date.now();
    if (
      assessment.available &&
      assessment.confidence >= this.config.warnThreshold &&
      now - this.lastAcousticEvalAt > 250
    ) {
      this.lastAcousticEvalAt = now;
      const result = fuse({ keyword: null, acoustic: assessment });
      if (result) this.evaluate(result);
    }
  }

  private handleResult(transcript: string, confidence: number | undefined, isFinal: boolean): void {
    store().setLastTranscript(transcript);
    if (!transcript || !this.canAlert()) return;

    const keyword = matchKeywords({
      transcript,
      recognizerConfidence: confidence,
      keywords: this.config.keywords,
    });
    if (!keyword) return;
    // Interim results may alert (speed matters in emergencies) but need a higher bar.
    if (!isFinal && keyword.confidence < this.config.warnThreshold + 10) return;

    const acoustic = this.config.acousticDetection ? this.acoustic.assess() : null;
    const result = fuse({ keyword, acoustic, transcript });
    if (result) this.evaluate(result);
  }

  private handleError(code: string, message: string): void {
    const benign = ['no-speech', 'no-match', 'speech-timeout', 'client'];
    if (this.wantRunning && benign.includes(code)) {
      this.scheduleRestart(400);
      return;
    }
    if (this.wantRunning) {
      store().setStatus('ERROR', `Recognizer error: ${message}. Retrying…`);
      this.scheduleRestart(1500);
    }
  }

  private handleEnd(): void {
    // The OS recognizer commonly ends after a pause; restart to stay continuous.
    if (this.wantRunning) this.scheduleRestart(300);
  }

  // ─── PLACEHOLDER_TAIL ───

  /** True when we're allowed to raise a new alert (not already alerting/cooling/escalating). */
  private canAlert(): boolean {
    const s = store();
    if (s.activeAlert || this.escalating) return false;
    if (Date.now() < this.cooldownUntil) return false;
    // If an emergency is already active/activating, detection shouldn't stack another.
    const phase = app().emergencyPhase;
    if (phase === 'ACTIVE' || phase === 'ACTIVATING' || app().activeEmergency) return false;
    return true;
  }

  // ─── Decision / evaluation ─────────────────────────────────────────────────

  private evaluate(result: DetectionResult): void {
    if (!this.canAlert()) return;
    store().setStatus('EVALUATING');
    store().setLastResult(result);
    // Mirror the latest event into the global store for existing screens.
    app().setCurrentAiEvent({
      id: '',
      detectedPhrase: result.detectedPhrase,
      detectionType: result.detectionType,
      confidence: result.confidence,
      riskLevel: result.riskLevel,
      actionTaken: 'ALERT_SHOWN',
    });

    if (result.confidence >= this.config.autoEscalateThreshold) {
      void this.raiseAlert(result, 'HIGH');
    } else if (result.confidence >= this.config.warnThreshold) {
      void this.raiseAlert(result, 'MEDIUM');
    } else {
      // Low confidence: log quietly as IGNORED, never interrupt the user.
      void this.logDetection(result, 'IGNORED');
      this.setListeningStatus();
    }
  }

  private async raiseAlert(result: DetectionResult, kind: 'HIGH' | 'MEDIUM'): Promise<void> {
    // Enter cooldown immediately so a repeated scream/word can't stack alerts.
    this.cooldownUntil = Date.now() + this.config.alertCooldownMs;
    store().setStatus('ALERTING');

    const countdownSeconds = kind === 'HIGH' && this.config.autoEscalate ? this.config.countdownSeconds : 0;
    store().setActiveAlert({ kind, result, eventId: null, countdownSeconds });

    if (kind === 'HIGH') {
      await presentLocalNotification(
        'Possible distress detected',
        this.config.autoEscalate
          ? `SafeLink will activate SOS in ${this.config.countdownSeconds}s unless you cancel.`
          : 'Tap to confirm SOS or mark yourself safe.'
      );
    }

    // Log the alert (best-effort) and remember the backend id for the response.
    const id = await this.logDetection(result, 'ALERT_SHOWN');
    if (id) {
      const a = store().activeAlert;
      if (a) store().setActiveAlert({ ...a, eventId: id });
    }

    if (countdownSeconds > 0) this.startCountdown();
  }

  private startCountdown(): void {
    this.clearCountdown();
    this.countdownTimer = setInterval(() => {
      const a = store().activeAlert;
      if (!a) {
        this.clearCountdown();
        return;
      }
      const next = a.countdownSeconds - 1;
      if (next <= 0) {
        this.clearCountdown();
        void this.escalate('auto');
      } else {
        store().updateAlertCountdown(next);
      }
    }, 1000);
  }

  // ─── User / auto responses ─────────────────────────────────────────────────

  /**
   * Escalate to a real emergency via the EXISTING engine. Guarded against duplicates.
   * @param via 'auto' (countdown elapsed) or 'manual' (user tapped Activate SOS).
   */
  async escalate(via: 'auto' | 'manual'): Promise<void> {
    if (this.escalating) return;
    this.escalating = true;
    this.clearCountdown();

    const alert = store().activeAlert;
    const result = alert?.result ?? store().lastResult;
    store().setStatus('ESCALATING');

    try {
      const emergency = await emergencyEngine.activate({
        source: 'AI_DETECTION',
        riskLevel: (result?.riskLevel as any) ?? 'HIGH',
        aiEventId: alert?.eventId ?? undefined,
      });
      if (alert?.eventId) void this.respond(alert.eventId, 'SOS_ACTIVATED');
      if (result) this.markLog(result, emergency ? 'SOS_ACTIVATED' : 'ALERT_SHOWN');
    } finally {
      store().setActiveAlert(null);
      this.escalating = false;
      // Keep cooldown so we don't immediately re-alert while the emergency screen shows.
      this.cooldownUntil = Date.now() + this.config.alertCooldownMs;
      this.setListeningStatus();
    }
  }

  /** User pressed "I'm Safe / Cancel" on the alert. Records the cancellation. */
  cancelAlert(): void {
    const alert = store().activeAlert;
    this.clearCountdown();
    if (alert?.eventId) void this.respond(alert.eventId, 'CANCELLED');
    if (alert?.result) this.markLog(alert.result, 'CANCELLED');
    store().setActiveAlert(null);
    this.cooldownUntil = Date.now() + this.config.alertCooldownMs;
    this.setListeningStatus();
  }

  // ─── Logging (reuses the existing /ai/detection API) ────────────────────────

  private async logDetection(result: DetectionResult, action: AiActionTaken): Promise<string | null> {
    const entry: DetectionLogEntry = {
      id: uid(),
      at: result.at,
      detectionType: result.detectionType,
      detectedPhrase: result.detectedPhrase,
      confidence: result.confidence,
      riskLevel: result.riskLevel,
      action,
      synced: false,
    };
    store().addLog(entry);

    try {
      const { data } = await aiAPI.logDetection({
        detectedPhrase: result.detectedPhrase ?? null,
        detectionType: result.detectionType,
        confidence: result.confidence,
        keywordConfidence: result.keywordConfidence,
        acousticConfidence: result.acousticConfidence,
        rawTranscript: result.rawTranscript ?? null,
        actionTaken: action,
      });
      const backendId: string | null = data?.event?.id ?? null;
      store().updateLog(entry.id, { synced: true });
      if (backendId) {
        const cur = app().currentAiEvent;
        if (cur) app().setCurrentAiEvent({ ...cur, id: backendId, actionTaken: action });
      }
      return backendId;
    } catch {
      // Never let logging failure block the safety flow — keep the local entry.
      return null;
    }
  }

  private async respond(eventId: string, action: 'SOS_ACTIVATED' | 'CANCELLED'): Promise<void> {
    try {
      await aiAPI.respondToDetection(eventId, action);
    } catch {
      /* best-effort */
    }
  }

  /** Update the most recent matching in-memory log entry's action. */
  private markLog(result: DetectionResult, action: AiActionTaken): void {
    const latest = store().log.find((e) => e.at === result.at) ?? store().log[0];
    if (latest) store().updateLog(latest.id, { action });
  }

  // ─── Timers / lifecycle helpers ─────────────────────────────────────────────

  private scheduleRestart(delayMs: number): void {
    this.clearRestart();
    if (!this.wantRunning) return;
    this.restartTimer = setTimeout(() => {
      if (this.wantRunning && !this.speech.isRunning) this.startRecognition();
    }, delayMs);
  }

  private clearRestart(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private clearCountdown(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  /** Ease the loudness meter back toward 0 between volume samples. */
  private startLevelDecay(): void {
    this.stopLevelDecay();
    this.levelDecayTimer = setInterval(() => {
      const cur = store().currentLevel;
      if (cur > 0.01) store().setCurrentLevel(Math.max(0, cur - 0.08));
    }, 200);
  }

  private stopLevelDecay(): void {
    if (this.levelDecayTimer) clearInterval(this.levelDecayTimer);
    this.levelDecayTimer = null;
  }

  /** Re-read settings after the user edits them (keywords/threshold/etc.). */
  async refreshConfig(): Promise<void> {
    this.config = resolveConfig(app().user);
    if (this.wantRunning && this.speech.isAvailable()) {
      this.speech.stop();
      this.scheduleRestart(300);
    }
  }
}

export const aiVoiceController = new AiVoiceDetectionController();
