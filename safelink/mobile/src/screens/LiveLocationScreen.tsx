import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useStore } from '../store';
import { Colors, Spacing, BorderRadius, Shadows } from '../theme';
import { getLiveStatus } from '../emergency/EmergencyEngine';
import OsmMapView from '../components/OsmMapView';
import { watchPosition, type Coordinates, type LocationSubscription } from '../services/location.service';

/**
 * Live Location screen — shows the emergency's most recent device GPS fix on a
 * free OpenStreetMap (Leaflet inside a WebView; no Google Maps SDK or API key).
 *
 * Coordinates come straight from the store, which the Emergency Engine keeps
 * updating from the real device GPS watcher and sending to the backend — this
 * screen adds nothing to that flow. It runs its own lightweight GPS watcher for
 * the blue "device" dot, mirroring the old showsUserLocation behaviour.
 */

const agoLabel = (ts: number | null, now: number) => {
  if (!ts) return 'not yet';
  const secs = Math.max(0, Math.floor((now - ts) / 1000));
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
};

export default function LiveLocationScreen({ onClose }: { onClose: () => void }) {
  const { activeEmergency, lastLocationUpdateAt, isOnline } = useStore();
  const [now, setNow] = useState(Date.now());
  const [following, setFollowing] = useState(true);
  const [deviceCoords, setDeviceCoords] = useState<Coordinates | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Blue dot: this device's live GPS fix. Runs alongside (never replaces) the
  // Emergency Engine's watcher, which feeds the backend and drives the pin.
  useEffect(() => {
    let sub: LocationSubscription | null = null;
    let cancelled = false;
    void watchPosition((c) => setDeviceCoords(c), 3).then((s) => {
      if (cancelled) s?.remove();
      else sub = s;
    });
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  const lat = activeEmergency?.currentLatitude;
  const lng = activeEmergency?.currentLongitude;
  const hasCoords = typeof lat === 'number' && typeof lng === 'number';
  const showMap = hasCoords && Platform.OS !== 'web';
  const live = getLiveStatus(lastLocationUpdateAt, isOnline, now);

  const statusText =
    live === 'LIVE'
      ? 'Live — sharing now'
      : live === 'STALE'
      ? `Reconnecting — last update ${agoLabel(lastLocationUpdateAt, now)}`
      : 'Offline — updates paused';
  const statusColor = live === 'LIVE' ? Colors.live : live === 'STALE' ? Colors.warning : Colors.offline;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Map (native) or coordinates fallback (web / no fix yet) */}
      {showMap ? (
        <OsmMapView
          latitude={lat!}
          longitude={lng!}
          title="Your shared location"
          description={activeEmergency?.currentAddress}
          deviceLatitude={deviceCoords?.latitude}
          deviceLongitude={deviceCoords?.longitude}
          following={following}
          onUserPan={() => setFollowing(false)}
        />
      ) : (
        <View style={styles.fallback}>
          <Text style={styles.fallbackIcon}>📍</Text>
          {hasCoords ? (
            <>
              <Text style={styles.fallbackTitle}>Live coordinates</Text>
              <Text style={styles.fallbackCoords}>{lat!.toFixed(6)}, {lng!.toFixed(6)}</Text>
              <Text style={styles.fallbackNote}>Map view is available on the mobile app.</Text>
            </>
          ) : (
            <>
              <Text style={styles.fallbackTitle}>Waiting for GPS…</Text>
              <Text style={styles.fallbackNote}>No location fix yet. Make sure location is enabled.</Text>
            </>
          )}
        </View>
      )}

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
          <Text style={styles.closeText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={[styles.statusPill, { backgroundColor: statusColor }]}>
          <Text style={styles.statusPillText}>{live}</Text>
        </View>
      </View>

      {/* Resume auto-following after the user panned away */}
      {showMap && !following && (
        <TouchableOpacity style={styles.recenterBtn} onPress={() => setFollowing(true)} activeOpacity={0.8}>
          <Text style={styles.recenterText}>◎  Recenter</Text>
        </TouchableOpacity>
      )}

      {/* Bottom info card */}
      <View style={styles.infoCard}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text style={styles.statusLabel}>{statusText}</Text>
        </View>
        <Text style={styles.address} numberOfLines={2}>
          {activeEmergency?.currentAddress || (hasCoords ? `${lat!.toFixed(5)}, ${lng!.toFixed(5)}` : 'Locating…')}
        </Text>
        {hasCoords && (
          <Text style={styles.coordsSmall}>Lat {lat!.toFixed(5)} · Lng {lng!.toFixed(5)}</Text>
        )}
        {showMap && <Text style={styles.attribution}>Map data © OpenStreetMap contributors</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.darkBg },

  fallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  fallbackIcon: { fontSize: 56, marginBottom: 12 },
  fallbackTitle: { fontSize: 18, fontWeight: '700', color: Colors.darkText },
  fallbackCoords: { fontSize: 16, color: Colors.darkText, marginTop: 8, fontVariant: ['tabular-nums'] },
  fallbackNote: { fontSize: 13, color: Colors.darkTextSecondary, marginTop: 8, textAlign: 'center' },

  topBar: {
    position: 'absolute', top: 50, left: Spacing.base, right: Spacing.base,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  closeBtn: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: BorderRadius.full },
  closeText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  statusPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: BorderRadius.full },
  statusPillText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 1 },

  recenterBtn: {
    position: 'absolute', right: Spacing.base, bottom: 190,
    backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 14, paddingVertical: 9,
    borderRadius: BorderRadius.full,
  },
  recenterText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  infoCard: {
    position: 'absolute', left: Spacing.base, right: Spacing.base, bottom: 40,
    backgroundColor: '#fff', borderRadius: BorderRadius.lg, padding: Spacing.lg, ...Shadows.md,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusLabel: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  address: { fontSize: 15, color: Colors.textPrimary, fontWeight: '500' },
  coordsSmall: { fontSize: 12, color: Colors.textMuted, marginTop: 6, fontVariant: ['tabular-nums'] },
  attribution: { fontSize: 10, color: Colors.textMuted, marginTop: 6 },
});
