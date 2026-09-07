/**
 * AiVoiceDetectionScreen — the FR-28 control surface (the screen behind the existing
 * "AI Detection" card on Home).
 *
 * Lets the user arm/disarm continuous listening, see the live pipeline status + mic
 * level, tune their distress keywords / sensitivity (persisted through the EXISTING
 * `/ai/settings` API), and review recent on-device detections. It only *controls* the
 * module — the actual detection + SOS escalation runs in the singleton controller so it
 * keeps working across tabs and after this screen is closed.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, TextInput,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Colors, Spacing, BorderRadius } from '../../theme';
import { useStore } from '../../store';
import { aiAPI } from '../../services/api';
import { useAiVoiceDetection } from '../useAiVoiceDetection';
import type { AiVoiceStatus, DetectionLogEntry } from '../types';

const STATUS_META: Record<AiVoiceStatus, { label: string; color: string }> = {
  OFF: { label: 'Off', color: Colors.offline },
  STARTING: { label: 'Starting…', color: Colors.uploading },
  LISTENING: { label: 'Listening', color: Colors.live },
  DETECTING: { label: 'Detecting…', color: Colors.warning },
  EVALUATING: { label: 'Evaluating…', color: Colors.warning },
  ALERTING: { label: 'Alert active', color: Colors.sos },
  ESCALATING: { label: 'Activating SOS…', color: Colors.sos },
  COOLDOWN: { label: 'Cooldown', color: Colors.uploading },
  UNAVAILABLE: { label: 'Unavailable', color: Colors.offline },
  ERROR: { label: 'Error', color: Colors.sos },
};

const timeLabel = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function AiVoiceDetectionScreen({ onClose }: { onClose: () => void }) {
  const {
    enabled, status, statusDetail, micPermission, speechAvailable, acousticAvailable,
    supported, currentLevel, lastTranscript, lastResult, log,
    toggle, refreshConfig, clearLog,
  } = useAiVoiceDetection();

  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);

  // ─── Editable settings (seeded from the saved profile) ─────────────────────
  const [keywordText, setKeywordText] = useState('');
  const [threshold, setThreshold] = useState(75);
  const [acoustic, setAcoustic] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ai = user?.aiSettings;
    setKeywordText((ai?.keywords ?? []).join(', '));
    setThreshold(ai?.confidenceThreshold ?? 75);
    setAcoustic(ai?.acousticDetection ?? true);
  }, [user?.aiSettings]);

  const meta = STATUS_META[status];
  const levelPct = Math.round(Math.min(1, Math.max(0, currentLevel)) * 100);

  const dirty = useMemo(() => {
    const ai = user?.aiSettings;
    const savedKeywords = (ai?.keywords ?? []).join(', ');
    return (
      keywordText.trim() !== savedKeywords.trim() ||
      threshold !== (ai?.confidenceThreshold ?? 75) ||
      acoustic !== (ai?.acousticDetection ?? true)
    );
  }, [keywordText, threshold, acoustic, user?.aiSettings]);

  const parsedKeywords = () =>
    keywordText
      .split(/[,\n]/)
      .map((k) => k.toLowerCase().trim())
      .filter(Boolean);

  const saveSettings = async () => {
    const keywords = parsedKeywords();
    const payload = { keywords, confidenceThreshold: threshold, acousticDetection: acoustic };
    setSaving(true);
    // Optimistically reflect locally so the UI + controller pick it up immediately.
    if (user) setUser({ ...user, aiSettings: { enabled, ...payload } });
    try {
      await aiAPI.updateSettings(payload);
    } catch {
      // Keep the local change; the backend can re-sync later. Surface a gentle note.
      if (Platform.OS !== 'web') {
        Alert.alert('Saved locally', 'Couldn\'t reach the server — settings will sync when you\'re back online.');
      }
    } finally {
      await refreshConfig();
      setSaving(false);
    }
  };

  const onToggle = () => {
    if (!supported && !enabled) {
      Alert.alert(
        'Development build required',
        'Voice detection needs the native speech module, which isn\'t in Expo Go or web. Manual SOS still works. Build a dev client to enable it.'
      );
    }
    toggle();
  };

  const bars = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1];

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn} activeOpacity={0.7}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AI Voice Detection</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Master toggle */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, paddingRight: Spacing.base }}>
              <Text style={styles.cardTitle}>Continuous listening</Text>
              <Text style={styles.cardSub}>
                Monitors your mic for distress words and screams, then offers to trigger SOS.
              </Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={onToggle}
              trackColor={{ true: Colors.primary, false: '#3A3A52' }}
              thumbColor="#fff"
            />
          </View>

          <View style={[styles.statusPill, { borderColor: meta.color }]}>
            <View style={[styles.dot, { backgroundColor: meta.color }]} />
            <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          {!!statusDetail && <Text style={styles.detail}>{statusDetail}</Text>}
        </View>

        {/* Live signal */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Live signal</Text>
          <View style={styles.meter}>
            {bars.map((b, i) => (
              <View
                key={i}
                style={[
                  styles.meterBar,
                  {
                    height: 8 + b * 40,
                    backgroundColor: currentLevel >= b ? (b > 0.7 ? Colors.sos : Colors.live) : '#2A2A44',
                  },
                ]}
              />
            ))}
            <Text style={styles.meterPct}>{levelPct}%</Text>
          </View>
          <Text style={styles.detail}>
            Mic: {micPermission} · Speech: {speechAvailable ? 'ready' : 'n/a'} · Acoustic:{' '}
            {acousticAvailable ? 'ready' : 'n/a'}
          </Text>
          {!!lastTranscript && <Text style={styles.transcript}>“{lastTranscript}”</Text>}
          {!!lastResult && (
            <Text style={styles.detail}>
              Last: {lastResult.detectionType} · {lastResult.riskLevel} ·{' '}
              {Math.round(lastResult.confidence)}%
            </Text>
          )}
        </View>

        {/* Settings */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Distress keywords</Text>
          <Text style={styles.cardSub}>Comma-separated. Matching is spelling/accent tolerant.</Text>
          <TextInput
            style={styles.input}
            value={keywordText}
            onChangeText={setKeywordText}
            placeholder="help, bachao, save me…"
            placeholderTextColor={Colors.darkTextSecondary}
            multiline
            autoCapitalize="none"
          />

          <View style={[styles.rowBetween, { marginTop: Spacing.base }]}>
            <Text style={styles.cardTitle}>Auto-SOS sensitivity</Text>
            <Text style={styles.thresholdVal}>{threshold}%</Text>
          </View>
          <Text style={styles.cardSub}>
            Confidence at or above this triggers the HIGH alert + countdown. Lower = more sensitive.
          </Text>
          <View style={styles.stepRow}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => setThreshold((t) => Math.max(50, t - 5))}
            >
              <Text style={styles.stepBtnText}>–</Text>
            </TouchableOpacity>
            <View style={styles.stepTrack}>
              <View style={[styles.stepFill, { width: `${((threshold - 50) / 50) * 100}%` }]} />
            </View>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => setThreshold((t) => Math.min(100, t + 5))}
            >
              <Text style={styles.stepBtnText}>+</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.rowBetween, { marginTop: Spacing.base }]}>
            <View style={{ flex: 1, paddingRight: Spacing.base }}>
              <Text style={styles.cardTitle}>Scream / loudness detection</Text>
              <Text style={styles.cardSub}>Detect screams even without recognizable words.</Text>
            </View>
            <Switch
              value={acoustic}
              onValueChange={setAcoustic}
              trackColor={{ true: Colors.primary, false: '#3A3A52' }}
              thumbColor="#fff"
            />
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled]}
            onPress={saveSettings}
            disabled={!dirty || saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>{dirty ? 'Save settings' : 'Saved'}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Recent detections */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Recent detections</Text>
            {log.length > 0 && (
              <TouchableOpacity onPress={clearLog}>
                <Text style={styles.clearText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
          {log.length === 0 ? (
            <Text style={styles.empty}>No detections yet.</Text>
          ) : (
            log.map((e: DetectionLogEntry) => (
              <View key={e.id} style={styles.logRow}>
                <View style={[styles.logDot, { backgroundColor: LOG_COLOR(e.action) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.logMain}>
                    {e.detectedPhrase ? `“${e.detectedPhrase}”` : e.detectionType} ·{' '}
                    {Math.round(e.confidence)}%
                  </Text>
                  <Text style={styles.logSub}>
                    {e.action} · {e.riskLevel} · {timeLabel(e.at)}
                    {e.synced ? '' : ' · unsynced'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        <Text style={styles.footer}>
          Manual SOS always works, even if voice detection is off or unavailable.
        </Text>
      </ScrollView>
    </View>
  );
}

const LOG_COLOR = (action: DetectionLogEntry['action']) =>
  action === 'SOS_ACTIVATED' ? Colors.sos
  : action === 'CANCELLED' ? Colors.safe
  : action === 'ALERT_SHOWN' ? Colors.warning
  : Colors.offline;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.darkBg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingBottom: Spacing.base, paddingHorizontal: Spacing.base,
    backgroundColor: Colors.darkSurface,
  },
  backBtn: { minWidth: 64 },
  backText: { color: Colors.primaryLight, fontSize: 16, fontWeight: '600' },
  headerTitle: { color: Colors.darkText, fontSize: 18, fontWeight: '800' },
  scroll: { padding: Spacing.base, paddingBottom: Spacing.xxl },

  card: {
    backgroundColor: Colors.darkCard, borderRadius: BorderRadius.lg, padding: Spacing.lg,
    marginBottom: Spacing.base,
  },
  cardTitle: { color: Colors.darkText, fontSize: 16, fontWeight: '700' },
  cardSub: { color: Colors.darkTextSecondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: 12, paddingVertical: 6,
    marginTop: Spacing.md,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusText: { fontSize: 13, fontWeight: '700' },
  detail: { color: Colors.darkTextSecondary, fontSize: 12, marginTop: Spacing.sm },
  transcript: { color: Colors.darkText, fontSize: 15, fontStyle: 'italic', marginTop: Spacing.sm },

  meter: { flexDirection: 'row', alignItems: 'flex-end', height: 52, marginTop: Spacing.md, gap: 6 },
  meterBar: { width: 10, borderRadius: 3 },
  meterPct: { color: Colors.darkTextSecondary, fontSize: 12, marginLeft: 'auto', alignSelf: 'center' },

  input: {
    backgroundColor: Colors.darkSurface, borderRadius: BorderRadius.md, color: Colors.darkText,
    padding: Spacing.md, marginTop: Spacing.sm, minHeight: 60, textAlignVertical: 'top', fontSize: 15,
  },
  thresholdVal: { color: Colors.primaryLight, fontSize: 16, fontWeight: '800' },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md, gap: Spacing.md },
  stepBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.darkSurface,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnText: { color: Colors.darkText, fontSize: 22, fontWeight: '800' },
  stepTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: Colors.darkSurface, overflow: 'hidden' },
  stepFill: { height: '100%', backgroundColor: Colors.primary },

  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.lg, paddingVertical: 14,
    alignItems: 'center', marginTop: Spacing.lg,
  },
  saveBtnDisabled: { backgroundColor: '#2A2A44' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  clearText: { color: Colors.primaryLight, fontSize: 13, fontWeight: '600' },
  empty: { color: Colors.darkTextSecondary, fontSize: 14, marginTop: Spacing.md },
  logRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md },
  logDot: { width: 10, height: 10, borderRadius: 5, marginRight: Spacing.md },
  logMain: { color: Colors.darkText, fontSize: 14, fontWeight: '600' },
  logSub: { color: Colors.darkTextSecondary, fontSize: 12, marginTop: 1 },

  footer: {
    color: Colors.darkTextSecondary, fontSize: 12, textAlign: 'center', marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg, lineHeight: 18,
  },
});
