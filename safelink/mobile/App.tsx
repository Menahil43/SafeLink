import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { Colors } from './src/theme';
import { useStore } from './src/store';
import { firebaseConfigError } from './src/config/firebase';
import { onAuthChange, signOutUser } from './src/services/auth.service';
import { hydrateSession } from './src/services/session.service';
import { loadContacts } from './src/services/contacts.service';
import { emergencyEngine } from './src/emergency/EmergencyEngine';
import { safetyTimerController } from './src/emergency/SafetyTimerController';
import { storage } from './src/services/storage';
import { subscribeToNetwork } from './src/services/network.service';
import {
  LOCK_SCREEN_SOS_ACTION,
  requestNotificationPermission,
  showLockScreenSosAction,
  hideLockScreenSosAction,
} from './src/services/notifications.service';
import HomeScreen from './src/screens/HomeScreen';
import ContactsScreen from './src/screens/ContactsScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AuthScreen from './src/screens/AuthScreen';
import EmergencyActiveScreen from './src/screens/EmergencyActiveScreen';
import SafetyTimerScreen from './src/screens/SafetyTimerScreen';
import AiVoiceDetectionScreen from './src/aiVoiceDetection/screens/AiVoiceDetectionScreen';
import DistressAlertOverlay from './src/aiVoiceDetection/components/DistressAlertOverlay';
import { aiVoiceController } from './src/aiVoiceDetection';

type Tab = 'home' | 'contacts' | 'history' | 'settings' | 'aiVoice';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'home', label: 'Home', icon: '🏠' },
  { key: 'contacts', label: 'Contacts', icon: '👥' },
  { key: 'history', label: 'History', icon: '📋' },
  { key: 'settings', label: 'Settings', icon: '⚙' },
];

export default function App() {
  const { user, activeEmergency, setIsOnline } = useStore();
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [booting, setBooting] = useState(true);
  const [showTimer, setShowTimer] = useState(false);
  const bootstrapping = useRef(false);
  const wasOnline = useRef(true);

  // Notification actions are delivered after Android brings the authenticated app
  // process forward. Route the real action into the single Emergency Engine.
  useEffect(() => {
    const handleResponse = (response: Notifications.NotificationResponse) => {
      if (response.actionIdentifier !== LOCK_SCREEN_SOS_ACTION) return;
      void Notifications.clearLastNotificationResponse();
      void hideLockScreenSosAction();
      void emergencyEngine.activate({ source: 'MANUAL_SOS' });
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) handleResponse(lastResponse);
    return () => subscription.remove();
  }, []);

  // ─── Network monitoring ───────────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeToNetwork((online) => {
      setIsOnline(online);
      // On reconnect while idle, re-check the backend for a still-open emergency
      // and restore any active Safety Timer.
      const s = useStore.getState();
      if (online && !wasOnline.current && s.user && s.emergencyPhase === 'IDLE') {
        void emergencyEngine.restore();
        void safetyTimerController.sync();
      }
      wasOnline.current = online;
    });
    return unsub;
  }, []);

  // ─── Auth state + session bootstrap (persistent login / cold-start restore) ──
  useEffect(() => {
    if (firebaseConfigError) { setBooting(false); return; }

    const unsub = onAuthChange(async (fbUser) => {
      if (fbUser) {
        if (!bootstrapping.current) {
          bootstrapping.current = true;
          try {
            // Cold start: a persisted Firebase session exists but the store is empty.
            if (!useStore.getState().user) await hydrateSession();
            await Promise.all([
              loadContacts().catch(() => undefined),
              emergencyEngine.restore().catch(() => undefined),
              safetyTimerController.sync().catch(() => undefined),
            ]);
            const notificationsGranted = await requestNotificationPermission();
            if (notificationsGranted) void showLockScreenSosAction();
            // Resume AI Voice Detection if the user had it enabled.
            if (useStore.getState().user?.aiSettings?.enabled) {
              void aiVoiceController.enable().catch(() => undefined);
            }
          } catch {
            // Backend unreachable → fall back to cached profile; otherwise sign out.
            const cached = await storage.getUserProfile();
            if (cached) useStore.getState().setUser(cached);
            else await signOutUser();
          } finally {
            bootstrapping.current = false;
          }
        }
      } else {
        void hideLockScreenSosAction();
        await aiVoiceController.disable().catch(() => undefined);
        useStore.getState().setUser(null);
        await emergencyEngine.reset();
      }
      setBooting(false);
    });
    return unsub;
  }, []);

  // ─── Render gating ──────────────────────────────────────────────────────────

  // Misconfigured Firebase: AuthScreen surfaces the exact missing env vars.
  if (firebaseConfigError) return <AuthScreen />;

  // Determining persisted auth state.
  if (booting) {
    return (
      <View style={styles.splash}>
        <StatusBar style="dark" />
        <Text style={styles.splashLogo}>🛡</Text>
        <Text style={styles.splashTitle}>SafeLink</Text>
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 16 }} />
      </View>
    );
  }

  // Not signed in.
  if (!user) return <AuthScreen />;

  // Active emergency takes over the whole screen.
  if (activeEmergency) return <EmergencyActiveScreen />;

  // Safety Timer push screen (overlays the tab navigation).
  if (showTimer) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <View style={styles.content}>
          <SafetyTimerScreen onBack={() => setShowTimer(false)} />
        </View>
      </SafeAreaView>
    );
  }

  const handleNavigate = (tab: string) => {
    if (tab === 'timer') {
      setShowTimer(true);
      return;
    }
    setActiveTab(tab as Tab);
  };

  const renderScreen = () => {
    switch (activeTab) {
      case 'home': return <HomeScreen onNavigate={handleNavigate} />;
      case 'contacts': return <ContactsScreen />;
      case 'history': return <HistoryScreen />;
      case 'settings': return <SettingsScreen />;
      case 'aiVoice': return <AiVoiceDetectionScreen onClose={() => setActiveTab('home')} />;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.content}>{renderScreen()}</View>
      <DistressAlertOverlay />

      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity key={tab.key} style={styles.tab} onPress={() => setActiveTab(tab.key)} activeOpacity={0.7}>
              <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>{tab.icon}</Text>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
              {isActive && <View style={styles.tabIndicator} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1 },

  splash: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  splashLogo: { fontSize: 56 },
  splashTitle: { fontSize: 28, fontWeight: '800', color: Colors.primary, marginTop: 8, letterSpacing: 0.5 },

  tabBar: {
    flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: Colors.borderLight,
    paddingBottom: 20, paddingTop: 8, paddingHorizontal: 4,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, position: 'relative' },
  tabIcon: { fontSize: 22, opacity: 0.45 },
  tabIconActive: { opacity: 1 },
  tabLabel: { fontSize: 11, color: Colors.textMuted, marginTop: 2, fontWeight: '500' },
  tabLabelActive: { color: Colors.primary, fontWeight: '700' },
  tabIndicator: { position: 'absolute', top: -8, width: 20, height: 3, borderRadius: 2, backgroundColor: Colors.primary },
});
