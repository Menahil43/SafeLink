import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Modal } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useStore } from '../store';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { emergencyEngine, getLiveStatus } from '../emergency/EmergencyEngine';
import { recordingService } from '../services/recording.service';
import LiveLocationScreen from './LiveLocationScreen';

const formatElapsed = (secs: number) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const agoLabel = (ts: number | null, now: number) => {
  if (!ts) return 'not yet';
  const secs = Math.max(0, Math.floor((now - ts) / 1000));
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
};

export default function EmergencyActiveScreen() {
  const { activeEmergency, emergencyPhase, lastLocationUpdateAt, isOnline, locationAvailable, recordingStatus, recordingDurationSeconds, recordingUploadedChunks, recordingError } = useStore();
  const [now, setNow] = useState(Date.now());
  const [showMap, setShowMap] = useState(false);

  // 1-second tick drives both the elapsed timer and the location-freshness label.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!activeEmergency) return null;

  const elapsed = Math.max(0, Math.floor((now - new Date(activeEmergency.startedAt).getTime()) / 1000));
  const live = getLiveStatus(lastLocationUpdateAt, isOnline, now);
  const resolving = emergencyPhase === 'RESOLVING';

  const statusMeta =
    live === 'LIVE'
      ? { dot: '#fff', label: 'LIVE', sub: 'Sharing your live location' }
      : live === 'STALE'
      ? { dot: Colors.warning, label: 'RECONNECTING', sub: `Last update ${agoLabel(lastLocationUpdateAt, now)}` }
      : { dot: Colors.textMuted, label: 'OFFLINE', sub: 'Updates paused — will resume when back online' };

  const confirmResolve = () => {
    Alert.alert('Are you safe?', 'This ends the emergency and notifies your contacts that you are safe.', [
      { text: 'Not yet', style: 'cancel' },
      { text: "Yes, I'm safe", style: 'default', onPress: () => { void emergencyEngine.resolve(); } },
    ]);
  };

  const confirmCancel = () => {
    Alert.alert('Cancel alert?', 'Only cancel if this was a false alarm. Contacts will not be told you are safe.', [
      { text: 'Keep active', style: 'cancel' },
      { text: 'Cancel alert', style: 'destructive', onPress: () => { void emergencyEngine.cancel(); } },
    ]);
  };

  if (showMap) {
    return (
      <Modal visible animationType="slide" onRequestClose={() => setShowMap(false)}>
        <LiveLocationScreen onClose={() => setShowMap(false)} />
      </Modal>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.badge}>
          <View style={[styles.badgeDot, { backgroundColor: statusMeta.dot }]} />
          <Text style={styles.badgeText}>{statusMeta.label}</Text>
        </View>
        <Text style={styles.title}>Emergency Active</Text>
        <Text style={styles.timer}>{formatElapsed(elapsed)}</Text>
        <Text style={styles.sub}>{statusMeta.sub}</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Type</Text>
          <Text style={styles.infoValue}>{activeEmergency.type.replace(/_/g, ' ')}</Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Risk Level</Text>
          <Text style={styles.infoValue}>{activeEmergency.riskLevel}</Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Contacts Notified</Text>
          <Text style={styles.infoValue}>{activeEmergency.notifiedContacts}</Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Location</Text>
          <Text style={styles.infoValue} numberOfLines={1}>
            {locationAvailable ? (activeEmergency.currentAddress || 'Tracking…') : 'Unavailable'}
          </Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Recording</Text>
          <Text style={styles.infoValue}>{recordingStatus === 'failed' ? `Recording failed: ${recordingError || 'Unknown error'}` : recordingStatus === 'recording' ? `Recording (${formatElapsed(recordingDurationSeconds)})` : recordingService.statusLabel()}</Text>
        </View>
        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>Local storage</Text>
          <Text style={styles.infoValue}>{recordingStatus === 'not_started' ? 'Not started' : recordingStatus === 'permission_denied' ? 'Permission denied' : recordingStatus === 'failed' ? 'Failed' : recordingStatus === 'finalizing' ? 'Saving…' : recordingUploadedChunks > 0 ? `${recordingUploadedChunks} segment${recordingUploadedChunks === 1 ? '' : 's'} saved` : 'Waiting for segment'}</Text>
        </View>

        <TouchableOpacity style={styles.mapBtn} onPress={() => setShowMap(true)} activeOpacity={0.85}>
          <Text style={styles.mapBtnText}>View live location on map</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.resolveBtn, resolving && styles.btnDisabled]}
          onPress={confirmResolve}
          disabled={resolving}
          activeOpacity={0.85}
        >
          {resolving
            ? <ActivityIndicator color={Colors.safe} />
            : <Text style={styles.resolveText}>I'm Safe — Resolve</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={confirmCancel} disabled={resolving} activeOpacity={0.7}>
          <Text style={styles.cancelText}>False alarm — cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.sos },

  header: { alignItems: 'center', paddingTop: 64, paddingBottom: 24 },
  badge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: BorderRadius.full, marginBottom: 12,
  },
  badgeDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 1.5 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700' },
  timer: { color: '#fff', fontSize: 52, fontWeight: '800', marginTop: 6, fontVariant: ['tabular-nums'] },
  sub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 6 },

  body: { paddingHorizontal: Spacing.base, gap: 10 },
  infoCard: {
    backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: Spacing.base, paddingVertical: 14,
    borderRadius: BorderRadius.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  infoLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 14 },
  infoValue: { color: '#fff', fontSize: 14, fontWeight: '700', maxWidth: '60%', textAlign: 'right' },

  mapBtn: {
    marginTop: 6, backgroundColor: 'rgba(255,255,255,0.22)', paddingVertical: 14,
    borderRadius: BorderRadius.md, alignItems: 'center',
  },
  mapBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  actions: { padding: Spacing.xl, marginTop: 'auto', paddingBottom: 40, gap: 12 },
  resolveBtn: { backgroundColor: '#fff', paddingVertical: 18, borderRadius: BorderRadius.lg, alignItems: 'center', ...Shadows.md },
  resolveText: { color: Colors.safe, fontSize: 17, fontWeight: '800' },
  btnDisabled: { opacity: 0.7 },
  cancelBtn: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '600' },
});
