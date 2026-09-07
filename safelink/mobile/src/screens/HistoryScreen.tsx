import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { createAudioPlayer } from 'expo-audio';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { historyAPI } from '../services/api';
import { recordingService, LocalRecordingMetadata } from '../services/recording.service';

interface HistoryItem {
  id: string;
  type: string;
  status: string;
  riskLevel: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  notifiedContacts: number;
  address?: string;
}

const riskColors: Record<string, string> = { LOW: Colors.safe, MEDIUM: Colors.warning, HIGH: Colors.sos, CRITICAL: Colors.sosDark };
const statusColors: Record<string, string> = { resolved: Colors.safe, cancelled: Colors.textMuted, active: Colors.sos, escalated: Colors.warning };
const typeIcons: Record<string, string> = { MANUAL_SOS: '🚨', SAFETY_TIMER: '⏱', AI_DETECTION: '🤖', ROUTE_DEVIATION: '🗺', OTHER: '⚠' };

const formatDuration = (secs: number) => {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / 60000))} min ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} hours ago`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} days ago`;
  return d.toLocaleDateString();
};

type Filter = 'all' | 'resolved' | 'cancelled';

function LocalRecordingRow({ item, onDeleted }: { item: LocalRecordingMetadata; onDeleted: (id: string) => void }) {
  const [playing, setPlaying] = useState(false);
  const [player] = useState(() => createAudioPlayer(item.localUri));

  useEffect(() => () => player.remove(), [player]);

  const toggle = () => {
    if (player.playing) { player.pause(); setPlaying(false); }
    else { player.play(); setPlaying(true); }
  };

  return (
    <View style={styles.localCard}>
      <View style={styles.localBody}>
        <Text style={styles.cardType}>Saved recording</Text>
        <Text style={styles.cardMetaText}>Emergency {item.emergencyId.slice(-8)}</Text>
        <Text style={styles.cardMetaText}>{new Date(item.createdAt).toLocaleString()} · {Math.round(item.duration)}s</Text>
      </View>
      <TouchableOpacity style={styles.playButton} onPress={toggle} accessibilityLabel={playing ? 'Pause recording' : 'Play recording'}>
        <Text style={styles.playButtonText}>{playing ? 'Pause' : 'Play'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.deleteButton} onPress={() => { void recordingService.deleteLocalRecording(item.recordingId).then(() => onDeleted(item.recordingId)); }} accessibilityLabel="Delete recording">
        <Text style={styles.deleteButtonText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function HistoryScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localRecordings, setLocalRecordings] = useState<LocalRecordingMetadata[]>([]);

  const load = async (initial = false) => {
    if (!initial) setRefreshing(true);
    setError(null);
    try {
      const { data } = await historyAPI.getAll(1);
      setItems((data.history || []) as HistoryItem[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(true); }, []);
  useEffect(() => { void recordingService.listLocalRecordings().then(setLocalRecordings); }, []);

  const filtered = filter === 'all' ? items : items.filter((h) => h.status === filter);
  const resolvedCount = items.filter((h) => h.status === 'resolved').length;
  const highRiskCount = items.filter((h) => h.riskLevel === 'HIGH' || h.riskLevel === 'CRITICAL').length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.subtitle}>Your past emergency events</Text>
      </View>

      <View style={styles.filters}>
        {(['all', 'resolved', 'cancelled'] as Filter[]).map((f: Filter) => (
          <TouchableOpacity key={f} style={[styles.filterChip, filter === f && styles.filterChipActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{items.length}</Text>
          <Text style={styles.statLabel}>Total Events</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: Colors.safe }]}>{resolvedCount}</Text>
          <Text style={styles.statLabel}>Resolved</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: Colors.sos }]}>{highRiskCount}</Text>
          <Text style={styles.statLabel}>High Risk</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.empty}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} tintColor={Colors.primary} />}
        >
          {error && (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>⚠</Text>
              <Text style={styles.emptyTitle}>Could not load history</Text>
              <Text style={styles.errorDesc}>{error}</Text>
            </View>
          )}
          {!error && filtered.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyTitle}>No events yet</Text>
            </View>
          )}
          {filtered.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardLeft}>
                <Text style={styles.cardIcon}>{typeIcons[item.type] || '⚠'}</Text>
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardType}>{item.type.replace(/_/g, ' ')}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: (statusColors[item.status] || Colors.textMuted) + '20' }]}>
                    <Text style={[styles.statusText, { color: statusColors[item.status] || Colors.textMuted }]}>{item.status}</Text>
                  </View>
                </View>
                {!!item.address && <Text style={styles.cardAddress}>{item.address}</Text>}
                <View style={styles.cardMeta}>
                  <Text style={styles.cardMetaText}>{formatDate(item.startedAt)}</Text>
                  {!!item.durationSeconds && item.durationSeconds > 0 && (
                    <Text style={styles.cardMetaText}> · {formatDuration(item.durationSeconds)}</Text>
                  )}
                  <Text style={styles.cardMetaText}> · {item.notifiedContacts} notified</Text>
                </View>
                <View style={[styles.riskDot, { backgroundColor: riskColors[item.riskLevel] || Colors.textMuted }]}>
                  <Text style={styles.riskLabel}>{item.riskLevel}</Text>
                </View>
              </View>
            </View>
          ))}
          {localRecordings.length > 0 && <Text style={styles.localTitle}>Saved on this device</Text>}
          {localRecordings.map((item) => <LocalRecordingRow key={item.recordingId} item={item} onDeleted={(id) => setLocalRecordings((current) => current.filter((entry) => entry.recordingId !== id))} />)}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingTop: 20, paddingHorizontal: Spacing.base, paddingBottom: Spacing.sm },
  title: { fontSize: 24, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },

  filters: { flexDirection: 'row', paddingHorizontal: Spacing.base, gap: 8, marginTop: Spacing.md },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  filterTextActive: { color: '#fff' },

  statsRow: { flexDirection: 'row', paddingHorizontal: Spacing.base, gap: 10, marginTop: Spacing.lg },
  statCard: { flex: 1, backgroundColor: Colors.surface, padding: Spacing.md, borderRadius: BorderRadius.md, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '800', color: Colors.textPrimary },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },

  list: { paddingHorizontal: Spacing.base, paddingTop: Spacing.lg, paddingBottom: 100 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: Colors.textSecondary, marginTop: 12 },
  errorDesc: { fontSize: 13, color: Colors.textMuted, marginTop: 8, textAlign: 'center', paddingHorizontal: 30 },

  card: {
    flexDirection: 'row', backgroundColor: Colors.surfaceCard, padding: Spacing.base,
    borderRadius: BorderRadius.lg, marginBottom: 10, ...Shadows.sm,
  },
  localTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, marginTop: 12, marginBottom: 8 },
  localCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceCard, padding: Spacing.base, borderRadius: BorderRadius.lg, marginBottom: 10, ...Shadows.sm },
  localBody: { flex: 1, gap: 3 },
  playButton: { backgroundColor: Colors.primary, paddingHorizontal: 10, paddingVertical: 7, borderRadius: BorderRadius.md, marginLeft: 8 },
  playButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  deleteButton: { paddingHorizontal: 8, paddingVertical: 7, marginLeft: 4 },
  deleteButtonText: { color: Colors.sos, fontSize: 12, fontWeight: '700' },
  cardLeft: { justifyContent: 'center', marginRight: 12 },
  cardIcon: { fontSize: 28 },
  cardBody: { flex: 1 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardType: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, textTransform: 'capitalize' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  cardAddress: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  cardMeta: { flexDirection: 'row', marginTop: 6 },
  cardMetaText: { fontSize: 12, color: Colors.textMuted },
  riskDot: { flexDirection: 'row', alignItems: 'center', marginTop: 6, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  riskLabel: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
