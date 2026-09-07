import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { useStore } from '../store';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { userAPI, API_BASE_URL } from '../services/api';
import { mapBackendUser } from '../services/session.service';
import { signOutUser } from '../services/auth.service';
import { emergencyEngine } from '../emergency/EmergencyEngine';
import { storage } from '../services/storage';
const initials = (name?: string) => (name ? name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) : '?');

export default function SettingsScreen() {
  const { user, setUser } = useStore();
  const [autoEscalate, setAutoEscalate] = useState(true);
  const [shareLocation, setShareLocation] = useState(true);
  const [shareRecordings, setShareRecordings] = useState(true);
  const [saving, setSaving] = useState(false);

  // Initialize toggles from the real backend profile.
  useEffect(() => {
    if (user?.emergencyPreferences) setAutoEscalate(!!user.emergencyPreferences.autoEscalate);
    if (user?.privacySettings) {
      setShareLocation(user.privacySettings.shareLocation !== false);
      setShareRecordings(!!user.privacySettings.shareRecordings);
    }
  }, [user]);

  // Persist a preference patch, then refresh the store from the server's response.
  const savePref = async (patch: Record<string, unknown>, revert: () => void) => {
    setSaving(true);
    try {
      const { data } = await userAPI.updateMe(patch);
      setUser(mapBackendUser(data.user));
    } catch (e) {
      revert();
      Alert.alert('Could not save', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleAutoEscalate = (val: boolean) => {
    setAutoEscalate(val);
    void savePref(
      { emergencyPreferences: { ...(user?.emergencyPreferences || {}), autoEscalate: val } },
      () => setAutoEscalate(!val)
    );
  };
  const toggleShareLocation = (val: boolean) => {
    setShareLocation(val);
    void savePref(
      { privacySettings: { ...(user?.privacySettings || {}), shareLocation: val } },
      () => setShareLocation(!val)
    );
  };
  const toggleShareRecordings = (val: boolean) => {
    setShareRecordings(val);
    void savePref(
      { privacySettings: { ...(user?.privacySettings || {}), shareRecordings: val } },
      () => setShareRecordings(!val)
    );
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await emergencyEngine.reset();
          await storage.clearSession();
          await signOutUser();
          setUser(null);
        },
      },
    ]);
  };

  const emergencyInterval = user?.emergencyPreferences?.locationUpdateIntervalEmergency;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.header}><Text style={styles.title}>Settings</Text></View>

      {/* Profile */}
      <View style={styles.profileCard}>
        <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{initials(user?.name)}</Text></View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{user?.name || 'Not logged in'}</Text>
          <Text style={styles.profileEmail}>{user?.email || ''}</Text>
          {!!user?.phone && <Text style={styles.profilePhone}>{user.phone}</Text>}
        </View>
      </View>

      {/* Emergency Preferences */}
      <Text style={styles.sectionTitle}>Emergency Preferences {saving && <Text style={styles.saving}>saving…</Text>}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Auto-escalate SOS</Text>
            <Text style={styles.rowDesc}>Automatically escalate if you don't respond</Text>
          </View>
          <Switch value={autoEscalate} onValueChange={toggleAutoEscalate} disabled={saving || !user}
            trackColor={{ true: Colors.primary + '60', false: Colors.border }} thumbColor={autoEscalate ? Colors.primary : '#f4f3f4'} />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Share live location</Text>
            <Text style={styles.rowDesc}>Send location updates to contacts during SOS</Text>
          </View>
          <Switch value={shareLocation} onValueChange={toggleShareLocation} disabled={saving || !user}
            trackColor={{ true: Colors.primary + '60', false: Colors.border }} thumbColor={shareLocation ? Colors.primary : '#f4f3f4'} />
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Share recordings</Text>
            <Text style={styles.rowDesc}>Upload microphone audio during emergencies</Text>
          </View>
          <Switch value={shareRecordings} onValueChange={toggleShareRecordings} disabled={saving || !user}
            trackColor={{ true: Colors.primary + '60', false: Colors.border }} thumbColor={shareRecordings ? Colors.primary : '#f4f3f4'} />
        </View>
        {!!emergencyInterval && (
          <>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Emergency update interval</Text>
              <Text style={styles.rowValue}>{emergencyInterval}s</Text>
            </View>
          </>
        )}
      </View>

      {/* About */}
      <Text style={styles.sectionTitle}>About</Text>
      <View style={styles.card}>
        <View style={styles.row}><Text style={styles.rowLabel}>Version</Text><Text style={styles.rowValue}>1.0.0</Text></View>
        <View style={styles.divider} />
        <View style={styles.row}><Text style={styles.rowLabel}>SDK</Text><Text style={styles.rowValue}>Expo 54</Text></View>
        <View style={styles.divider} />
        <View style={styles.row}><Text style={styles.rowLabel}>Backend</Text><Text style={styles.rowValue} numberOfLines={1}>{API_BASE_URL}</Text></View>
      </View>

      {user && (
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      )}
      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.base, paddingTop: 20 },
  header: { marginBottom: Spacing.md },
  title: { fontSize: 24, fontWeight: '700', color: Colors.textPrimary },

  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, padding: Spacing.base, borderRadius: BorderRadius.lg, ...Shadows.sm },
  profileAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { color: '#fff', fontWeight: '700', fontSize: 20 },
  profileInfo: { marginLeft: 14, flex: 1 },
  profileName: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  profileEmail: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  profilePhone: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, marginTop: Spacing.xl, marginBottom: Spacing.md },
  saving: { fontSize: 12, fontWeight: '500', color: Colors.textMuted },
  card: { backgroundColor: Colors.surfaceCard, borderRadius: BorderRadius.lg, padding: Spacing.base, ...Shadows.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  rowLabel: { fontSize: 15, fontWeight: '500', color: Colors.textPrimary },
  rowDesc: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  rowValue: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500', flexShrink: 1, textAlign: 'right', marginLeft: 'auto' },
  divider: { height: 1, backgroundColor: Colors.borderLight, marginVertical: 10 },

  logoutBtn: { marginTop: Spacing.xl, paddingVertical: 16, borderRadius: BorderRadius.md, backgroundColor: Colors.sosLight, alignItems: 'center' },
  logoutText: { fontSize: 15, fontWeight: '600', color: Colors.sos },
});
