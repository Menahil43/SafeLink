import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, Animated, Vibration, Platform, ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useStore, TrustedContact } from '../store';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { emergencyEngine } from '../emergency/EmergencyEngine';

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
const formatCountdown = (ms: number) => {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad(m)}:${pad(s)}`;
};

const getInitials = (name: string) => name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

// ─── Component ──────────────────────────────────────────────────────────────
export default function HomeScreen({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { user, contacts, emergencyPhase, emergencyError, activeTimer, timerPhase } = useStore();
  const [sosHolding, setSosHolding] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [now, setNow] = useState(Date.now());
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick for Safety Timer card countdown display.
  useEffect(() => {
    if (!activeTimer || timerPhase === 'NONE') return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [activeTimer, timerPhase]);

  const activating = emergencyPhase === 'ACTIVATING';

  // Pulse animation for the SOS button.
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // Surface an activation failure (e.g. backend unreachable) honestly.
  useEffect(() => {
    if (emergencyPhase === 'FAILED' && emergencyError) {
      Alert.alert('SOS could not activate', emergencyError);
    }
  }, [emergencyPhase, emergencyError]);

  // ─── SOS Logic ──────────────────────────────────────────────────────────
  const activateSOS = async () => {
    setSosHolding(false);
    setCountdown(0);
    if (Platform.OS !== 'web') Vibration.vibrate([0, 500, 200, 500]);
    // Real activation: creates the emergency on the backend, gets device GPS,
    // notifies contacts, and starts live tracking. App renders the active screen.
    await emergencyEngine.activate({ source: 'MANUAL_SOS' });
  };

  const startSOSHold = () => {
    if (activating) return;
    setSosHolding(true);
    setCountdown(3);
    let count = 3;
    countdownRef.current = setInterval(() => {
      count--;
      setCountdown(count);
      if (count <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        void activateSOS();
      }
    }, 1000);
  };

  const cancelSOSHold = () => {
    setSosHolding(false);
    setCountdown(0);
    if (countdownRef.current) clearInterval(countdownRef.current);
  };

  // ─── Dashboard UI ─────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hello, {user?.name || 'there'}</Text>
            <Text style={styles.subtitle}>You're safe today</Text>
          </View>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{getInitials(user?.name || 'U')}</Text>
          </View>
        </View>

        {/* SOS Button */}
        <View style={styles.sosSection}>
          <Animated.View style={{ transform: [{ scale: sosHolding ? 0.95 : pulseAnim }] }}>
            <TouchableOpacity
              style={[styles.sosButton, (sosHolding || activating) && styles.sosButtonHolding]}
              onPressIn={startSOSHold}
              onPressOut={cancelSOSHold}
              activeOpacity={0.85}
              disabled={activating}
            >
              {activating ? (
                <>
                  <ActivityIndicator color="#fff" size="large" />
                  <Text style={styles.sosSubtext}>Activating…</Text>
                </>
              ) : (
                <>
                  <Text style={styles.sosText}>{countdown > 0 ? countdown : 'SOS'}</Text>
                  <Text style={styles.sosSubtext}>
                    {sosHolding ? 'Keep holding…' : 'Hold for emergency'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>
          <Text style={styles.sosHint}>
            {contacts.length > 0
              ? `${contacts.length} trusted contact${contacts.length === 1 ? '' : 's'} will be alerted`
              : 'Add trusted contacts so they can be alerted'}
          </Text>
        </View>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          <TouchableOpacity style={styles.actionCard} onPress={() => onNavigate('contacts')}>
            <Text style={styles.actionIcon}>👥</Text>
            <Text style={styles.actionLabel}>Contacts</Text>
            <Text style={styles.actionCount}>{contacts.length} trusted</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => onNavigate('history')}>
            <Text style={styles.actionIcon}>📋</Text>
            <Text style={styles.actionLabel}>History</Text>
            <Text style={styles.actionCount}>Past events</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => onNavigate('timer')}>
            <Text style={styles.actionIcon}>⏱</Text>
            <Text style={styles.actionLabel}>Safety Timer</Text>
            {activeTimer && timerPhase !== 'NONE' ? (
              <View>
                <Text style={[styles.actionCount, { color: Colors.safe, fontWeight: '600' }]}>
                  {timerPhase === 'CHECK_IN' ? 'Check-in needed' : `${formatCountdown(new Date(activeTimer.expiryTime).getTime() - now)} left`}
                </Text>
              </View>
            ) : (
              <Text style={styles.actionCount}>Start timer</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionCard} onPress={() => onNavigate('aiVoice')}>
            <Text style={styles.actionIcon}>🤖</Text>
            <Text style={styles.actionLabel}>AI Detection</Text>
            <Text style={styles.actionCount}>Voice safety</Text>
          </TouchableOpacity>
        </View>

        {/* Trusted Contacts Preview */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Trusted Contacts</Text>
          <TouchableOpacity onPress={() => onNavigate('contacts')}>
            <Text style={styles.seeAll}>See All</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.contactsRow}>
          {contacts.slice(0, 6).map((c: TrustedContact) => (
            <View key={c.id} style={styles.contactChip}>
              <View style={[styles.contactAvatar, { backgroundColor: c.avatarColor }]}>
                <Text style={styles.contactAvatarText}>{getInitials(c.name)}</Text>
              </View>
              <Text style={styles.contactName} numberOfLines={1}>{c.name}</Text>
              <Text style={styles.contactRel} numberOfLines={1}>{c.relationship}</Text>
            </View>
          ))}
          {contacts.length === 0 && (
            <TouchableOpacity style={styles.addContactChip} onPress={() => onNavigate('contacts')}>
              <Text style={styles.addContactPlus}>+</Text>
              <Text style={styles.addContactText}>Add contacts</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </ScrollView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.base, paddingBottom: 40 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.base },
  greeting: { fontSize: 24, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  avatarCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '600', fontSize: 16 },

  sosSection: { alignItems: 'center', marginVertical: Spacing.xxl },
  sosButton: {
    width: 180, height: 180, borderRadius: 90, backgroundColor: Colors.sos,
    alignItems: 'center', justifyContent: 'center', ...Shadows.sos,
  },
  sosButtonHolding: { backgroundColor: Colors.sosDark },
  sosText: { color: Colors.textOnSOS, fontSize: 40, fontWeight: '800', letterSpacing: 3 },
  sosSubtext: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 6 },
  sosHint: { color: Colors.textSecondary, fontSize: 13, marginTop: Spacing.base, textAlign: 'center' },

  sectionTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary, marginTop: Spacing.lg, marginBottom: Spacing.md },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  actionCard: {
    flex: 1, minWidth: '45%', backgroundColor: Colors.surface, padding: Spacing.base,
    borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.borderLight,
  },
  actionIcon: { fontSize: 28, marginBottom: 8 },
  actionLabel: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  actionCount: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.lg, marginBottom: Spacing.md },
  seeAll: { color: Colors.primary, fontWeight: '600', fontSize: 14 },
  contactsRow: { flexDirection: 'row' },
  contactChip: { alignItems: 'center', marginRight: Spacing.base, width: 70 },
  contactAvatar: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  contactAvatarText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  contactName: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary, marginTop: 6, textAlign: 'center' },
  contactRel: { fontSize: 11, color: Colors.textSecondary },
  addContactChip: { alignItems: 'center', justifyContent: 'center', width: 90, height: 90 },
  addContactPlus: { fontSize: 28, color: Colors.primary, fontWeight: '300' },
  addContactText: { fontSize: 11, color: Colors.primary, marginTop: 4 },
});
