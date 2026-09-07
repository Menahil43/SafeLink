import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, TextInput, Keyboard,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { useStore } from '../store';
import { safetyTimerController } from '../emergency/SafetyTimerController';

// ─── Duration presets (seconds) ─────────────────────────────────────────────
const PRESETS = [
  { label: '15 min', seconds: 15 * 60 },
  { label: '30 min', seconds: 30 * 60 },
  { label: '45 min', seconds: 45 * 60 },
  { label: '1 hour', seconds: 60 * 60 },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

const formatCountdown = (ms: number) => {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

// ─── Component ──────────────────────────────────────────────────────────────
export default function SafetyTimerScreen({ onBack }: { onBack: () => void }) {
  const { activeTimer, timerPhase, timerError } = useStore();

  // Duration selection state (NONE phase)
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customMinutes, setCustomMinutes] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Countdown tick (re-renders every second)
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track whether we were in an active timer to detect "completed" transitions.
  const wasActiveRef = useRef(false);

  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // When a timer that was active becomes null (check-in, cancel, or escalation
  // handed off to Emergency Engine), navigate back to the home screen.
  useEffect(() => {
    if (timerPhase !== 'NONE' && activeTimer) {
      wasActiveRef.current = true;
    } else if (wasActiveRef.current && (!activeTimer || timerPhase === 'NONE')) {
      wasActiveRef.current = false;
      onBack();
    }
  }, [activeTimer, timerPhase]);

  // ─── Derived values ────────────────────────────────────────────────────────
  const remainingMs = activeTimer
    ? new Date(activeTimer.expiryTime).getTime() - now
    : 0;
  const graceRemainingMs = activeTimer
    ? new Date(activeTimer.escalateAt).getTime() - now
    : 0;

  const selectedSeconds = isCustom
    ? Math.max(0, parseInt(customMinutes, 10) || 0) * 60
    : selectedPreset;

  const canStart = selectedSeconds !== null && selectedSeconds >= 60 && !starting;

  // ─── Actions ──────────────────────────────────────────────────────────────
  const handleStart = async () => {
    if (!selectedSeconds || selectedSeconds < 60) return;
    Keyboard.dismiss();
    setStarting(true);
    setStartError(null);
    try {
      await safetyTimerController.start(selectedSeconds);
    } catch (err) {
      setStartError(
        (err as Error)?.message || 'Unable to start Safety Timer. Please check your connection and try again.'
      );
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancel Safety Timer?',
      'Your safety monitoring will stop. No emergency will be triggered.',
      [
        { text: 'Keep Timer', style: 'cancel' },
        {
          text: 'Cancel Timer',
          style: 'destructive',
          onPress: () => void safetyTimerController.cancel(),
        },
      ]
    );
  };

  const handleCheckIn = () => {
    void safetyTimerController.checkIn();
  };

  const handleNeedHelp = () => {
    Alert.alert(
      'Need Help?',
      'This will activate an emergency and alert your trusted contacts.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'I Need Help',
          style: 'destructive',
          onPress: () => void safetyTimerController.needHelp(),
        },
      ]
    );
  };

  // ─── Phase: NONE (duration selection) ──────────────────────────────────────
  if (timerPhase === 'NONE' || !activeTimer) {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onBack} style={styles.backButton}>
              <Text style={styles.backArrow}>{'<'} Back</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.title}>Safety Timer</Text>
          <Text style={styles.description}>
            How long do you want SafeLink to monitor your safety?
          </Text>

          {/* Preset durations */}
          <View style={styles.presetGrid}>
            {PRESETS.map((p) => {
              const isActive = !isCustom && selectedPreset === p.seconds;
              return (
                <TouchableOpacity
                  key={p.seconds}
                  style={[styles.presetCard, isActive && styles.presetCardActive]}
                  onPress={() => {
                    setSelectedPreset(p.seconds);
                    setIsCustom(false);
                    setCustomMinutes('');
                    setStartError(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.presetLabel, isActive && styles.presetLabelActive]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Custom duration */}
          <TouchableOpacity
            style={[styles.customCard, isCustom && styles.customCardActive]}
            onPress={() => {
              setIsCustom(true);
              setSelectedPreset(null);
              setStartError(null);
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.customLabel, isCustom && styles.customLabelActive]}>
              Custom
            </Text>
            {isCustom && (
              <View style={styles.customInputRow}>
                <TextInput
                  style={styles.customInput}
                  placeholder="Minutes"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                  value={customMinutes}
                  onChangeText={(t) => setCustomMinutes(t.replace(/[^0-9]/g, ''))}
                  autoFocus
                  maxLength={4}
                />
                <Text style={styles.customUnit}>min</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Error message */}
          {startError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{startError}</Text>
            </View>
          )}

          {/* Start button */}
          <TouchableOpacity
            style={[styles.startButton, !canStart && styles.startButtonDisabled]}
            onPress={handleStart}
            disabled={!canStart}
            activeOpacity={0.8}
          >
            {starting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.startButtonText}>START TIMER</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ─── Phase: ACTIVE (countdown running) ─────────────────────────────────────
  if (timerPhase === 'ACTIVE') {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onBack} style={styles.backButton}>
              <Text style={styles.backArrow}>{'<'} Back</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.timerDisplay}>
            <Text style={styles.timerLabel}>SAFETY TIMER</Text>
            <Text style={styles.timerCountdown}>{formatCountdown(remainingMs)}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: Colors.safe }]} />
              <Text style={styles.statusText}>Monitoring active</Text>
            </View>
            <Text style={styles.startedAt}>Started: {formatTime(activeTimer.startedAt)}</Text>
          </View>

          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.safeButton}
              onPress={handleCheckIn}
              activeOpacity={0.8}
            >
              <Text style={styles.safeButtonText}>I'M SAFE</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelTimerButton}
              onPress={handleCancel}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelTimerButtonText}>CANCEL TIMER</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ─── Phase: CHECK_IN (grace period — "Are you safe?") ─────────────────────
  if (timerPhase === 'CHECK_IN') {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.checkInContainer}>
          <Text style={styles.checkInTitle}>SAFETY CHECK-IN</Text>
          <Text style={styles.checkInSubtitle}>Your safety timer has ended.</Text>
          <Text style={styles.checkInQuestion}>Are you safe?</Text>

          <View style={styles.graceCountdownWrap}>
            <Text style={styles.graceLabel}>Emergency alert will be activated in:</Text>
            <Text style={styles.graceCountdown}>{formatCountdown(graceRemainingMs)}</Text>
          </View>

          <View style={styles.checkInButtons}>
            <TouchableOpacity
              style={styles.safeButton}
              onPress={handleCheckIn}
              activeOpacity={0.8}
            >
              <Text style={styles.safeButtonText}>I'M SAFE</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.needHelpButton}
              onPress={handleNeedHelp}
              activeOpacity={0.8}
            >
              <Text style={styles.needHelpButtonText}>I NEED HELP</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ─── Phase: ESCALATING ────────────────────────────────────────────────────
  if (timerPhase === 'ESCALATING') {
    return (
      <View style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.centeredContent}>
          <ActivityIndicator size="large" color={Colors.sos} />
          <Text style={styles.escalatingText}>Activating emergency...</Text>
          <Text style={styles.escalatingSubtext}>
            Your trusted contacts will be alerted shortly.
          </Text>
        </View>
      </View>
    );
  }

  // ─── Phase: ERROR ─────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.centeredContent}>
        <Text style={styles.errorIcon}>!</Text>
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorDesc}>
          {timerError || 'An unexpected error occurred with the Safety Timer.'}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={onBack}
          activeOpacity={0.8}
        >
          <Text style={styles.retryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.base, paddingBottom: 60 },

  // Header
  header: { marginTop: Spacing.sm, marginBottom: Spacing.base },
  backButton: { paddingVertical: 4 },
  backArrow: { fontSize: 16, color: Colors.primary, fontWeight: '600' },

  // Title / description
  title: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary, letterSpacing: 0.3 },
  description: { fontSize: 15, color: Colors.textSecondary, marginTop: 8, lineHeight: 22 },

  // Preset grid
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: Spacing.xl },
  presetCard: {
    flex: 1, minWidth: '45%', paddingVertical: 20, alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    borderWidth: 2, borderColor: Colors.borderLight,
  },
  presetCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primarySurface },
  presetLabel: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  presetLabelActive: { color: Colors.primary },

  // Custom
  customCard: {
    paddingVertical: 20, alignItems: 'center', marginTop: 12,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    borderWidth: 2, borderColor: Colors.borderLight,
  },
  customCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primarySurface },
  customLabel: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  customLabelActive: { color: Colors.primary },
  customInputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  customInput: {
    width: 80, height: 44, textAlign: 'center', fontSize: 20, fontWeight: '700',
    color: Colors.textPrimary, borderBottomWidth: 2, borderBottomColor: Colors.primary,
  },
  customUnit: { fontSize: 16, color: Colors.textSecondary, marginLeft: 8 },

  // Error banner
  errorBanner: {
    marginTop: Spacing.base, padding: Spacing.md,
    backgroundColor: Colors.sosLight, borderRadius: BorderRadius.md,
  },
  errorText: { fontSize: 13, color: Colors.sosDark, textAlign: 'center' },

  // Start button
  startButton: {
    marginTop: Spacing.xl, paddingVertical: 18, alignItems: 'center',
    backgroundColor: Colors.primary, borderRadius: BorderRadius.lg, ...Shadows.lg,
  },
  startButtonDisabled: { opacity: 0.4 },
  startButtonText: { fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: 1.5 },

  // Timer display (ACTIVE phase)
  timerDisplay: {
    alignItems: 'center', marginTop: Spacing.xxl, paddingVertical: Spacing.xxl,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl, ...Shadows.md,
  },
  timerLabel: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 2 },
  timerCountdown: {
    fontSize: 64, fontWeight: '800', color: Colors.textPrimary,
    marginTop: Spacing.sm, fontVariant: ['tabular-nums'],
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  startedAt: { fontSize: 13, color: Colors.textMuted, marginTop: 8 },

  // Action buttons
  actionButtons: { marginTop: Spacing.xxl, gap: 12 },
  safeButton: {
    paddingVertical: 18, alignItems: 'center',
    backgroundColor: Colors.safe, borderRadius: BorderRadius.lg, ...Shadows.md,
  },
  safeButtonText: { fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: 1 },
  cancelTimerButton: {
    paddingVertical: 18, alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.border,
  },
  cancelTimerButtonText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },

  // Check-in phase
  checkInContainer: { flex: 1, paddingHorizontal: Spacing.base, justifyContent: 'center' },
  checkInTitle: {
    fontSize: 14, fontWeight: '700', color: Colors.warning, letterSpacing: 2, textAlign: 'center',
  },
  checkInSubtitle: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', marginTop: 16 },
  checkInQuestion: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', marginTop: 8 },

  // Grace countdown
  graceCountdownWrap: {
    marginTop: Spacing.xl, padding: Spacing.base,
    backgroundColor: Colors.warningLight, borderRadius: BorderRadius.lg, alignItems: 'center',
  },
  graceLabel: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  graceCountdown: {
    fontSize: 36, fontWeight: '800', color: Colors.warning, marginTop: 8,
    fontVariant: ['tabular-nums'],
  },

  // Check-in buttons
  checkInButtons: { marginTop: Spacing.xxl, gap: 12 },
  needHelpButton: {
    paddingVertical: 18, alignItems: 'center',
    backgroundColor: Colors.sos, borderRadius: BorderRadius.lg, ...Shadows.sos,
  },
  needHelpButtonText: { fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: 1 },

  // Escalating
  centeredContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl },
  escalatingText: { fontSize: 20, fontWeight: '700', color: Colors.sos, marginTop: 20, textAlign: 'center' },
  escalatingSubtext: { fontSize: 14, color: Colors.textSecondary, marginTop: 8, textAlign: 'center' },

  // Error
  errorIcon: {
    fontSize: 28, fontWeight: '800', color: Colors.sos,
    width: 60, height: 60, textAlign: 'center', lineHeight: 60,
    backgroundColor: Colors.sosLight, borderRadius: 30, overflow: 'hidden',
  },
  errorTitle: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary, marginTop: 16 },
  errorDesc: { fontSize: 14, color: Colors.textSecondary, marginTop: 8, textAlign: 'center' },
  retryButton: {
    marginTop: Spacing.xl, paddingHorizontal: 40, paddingVertical: 14,
    backgroundColor: Colors.primary, borderRadius: BorderRadius.lg,
  },
  retryButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
