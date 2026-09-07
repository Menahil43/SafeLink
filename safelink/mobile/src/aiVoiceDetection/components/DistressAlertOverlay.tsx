/**
 * DistressAlertOverlay — the FR-28 alert surface.
 *
 * Rendered once at the app root; uses a React Native Modal so it floats above whatever
 * screen/tab is active. Reads the module store, so it appears automatically whenever the
 * controller raises an alert.
 *
 *   • HIGH  → "Possible Distress Detected", a visible countdown, and a prominent
 *             "I'm Safe / Cancel" button. If auto-escalation is on, SOS fires when the
 *             countdown reaches zero WITHOUT any further tap (user may be incapacitated).
 *   • MEDIUM → a softer warning; SOS is NEVER automatic — the user chooses.
 */

import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Animated, Vibration, Platform } from 'react-native';
import { Colors, Spacing, BorderRadius } from '../../theme';
import { useAiVoiceDetection } from '../useAiVoiceDetection';

export default function DistressAlertOverlay() {
  const { activeAlert, cancelAlert, escalateNow } = useAiVoiceDetection();
  const pulse = useRef(new Animated.Value(1)).current;

  const isHigh = activeAlert?.kind === 'HIGH';
  const counting = !!activeAlert && activeAlert.countdownSeconds > 0;

  useEffect(() => {
    if (!activeAlert) return;
    if (Platform.OS !== 'web') {
      Vibration.vibrate(isHigh ? [0, 400, 200, 400, 200, 400] : [0, 250], isHigh);
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      if (Platform.OS !== 'web') Vibration.cancel();
    };
  }, [activeAlert, isHigh]);

  if (!activeAlert) return null;
  const { result, countdownSeconds } = activeAlert;

  const phraseLabel =
    result.detectedPhrase
      ? `Heard: "${result.detectedPhrase}"`
      : result.detectionType === 'SCREAM'
      ? 'Possible scream detected'
      : 'Loud distress sound detected';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={cancelAlert} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Animated.View
          style={[styles.card, isHigh ? styles.cardHigh : styles.cardMedium, { transform: [{ scale: pulse }] }]}
        >
          <Text style={styles.badge}>{isHigh ? '⚠  POSSIBLE DISTRESS DETECTED' : 'Heads up'}</Text>
          <Text style={styles.title}>
            {isHigh ? 'Are you okay?' : 'We noticed something'}
          </Text>
          <Text style={styles.subtitle}>{phraseLabel}</Text>
          <Text style={styles.meta}>
            {result.detectionType} · {result.riskLevel} · {Math.round(result.confidence)}% confidence
          </Text>

          {counting ? (
            <View style={styles.countWrap}>
              <Text style={styles.countNumber}>{countdownSeconds}</Text>
              <Text style={styles.countLabel}>SOS will activate in {countdownSeconds}s</Text>
            </View>
          ) : (
            <Text style={styles.countLabel}>
              {isHigh ? 'Confirm to alert your trusted contacts.' : 'SOS will NOT activate automatically.'}
            </Text>
          )}

          <TouchableOpacity style={styles.safeBtn} onPress={cancelAlert} activeOpacity={0.85}>
            <Text style={styles.safeBtnText}>I'm Safe / Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.sosBtn} onPress={escalateNow} activeOpacity={0.85}>
            <Text style={styles.sosBtnText}>{counting ? 'Activate SOS now' : 'Activate SOS'}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  card: { width: '100%', maxWidth: 420, borderRadius: BorderRadius.xl, padding: Spacing.xl, backgroundColor: Colors.surfaceCard, alignItems: 'center' },
  cardHigh: { borderWidth: 3, borderColor: Colors.sos },
  cardMedium: { borderWidth: 3, borderColor: Colors.warning },
  badge: { fontSize: 12, fontWeight: '800', letterSpacing: 1, color: Colors.sos, marginBottom: Spacing.sm, textAlign: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary, marginBottom: 4, textAlign: 'center' },
  subtitle: { fontSize: 16, color: Colors.textPrimary, marginBottom: 4, textAlign: 'center' },
  meta: { fontSize: 12, color: Colors.textSecondary, marginBottom: Spacing.base, textAlign: 'center' },
  countWrap: { alignItems: 'center', marginVertical: Spacing.md },
  countNumber: { fontSize: 64, fontWeight: '900', color: Colors.sos, lineHeight: 68 },
  countLabel: { fontSize: 14, color: Colors.textSecondary, marginBottom: Spacing.base, textAlign: 'center' },
  safeBtn: { width: '100%', backgroundColor: Colors.safe, paddingVertical: 16, borderRadius: BorderRadius.lg, alignItems: 'center', marginTop: Spacing.sm },
  safeBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  sosBtn: { width: '100%', backgroundColor: Colors.sos, paddingVertical: 14, borderRadius: BorderRadius.lg, alignItems: 'center', marginTop: Spacing.sm },
  sosBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
