import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Colors } from '../theme';

/**
 * Free OpenStreetMap map view — no Google Maps SDK, no API key, no billing.
 *
 * Renders Leaflet (loaded from a public CDN) inside a WebView on top of
 * OpenStreetMap raster tiles. React Native pushes coordinate updates into the
 * page with injectJavaScript(); the page reports user pans back via
 * postMessage. Pinch-zoom, double-tap zoom and panning are handled by Leaflet.
 *
 * The shared-location pin is a pure-HTML div icon and the device dot a vector
 * circle, so the only network images ever fetched are the map tiles themselves.
 */

interface OsmMapViewProps {
  /** Location shared with trusted contacts (the emergency's current fix). */
  latitude: number;
  longitude: number;
  /** Marker title/popup label for the shared location. */
  title?: string;
  /** Marker popup detail (e.g. reverse-geocoded address). */
  description?: string;
  /** This device's own live GPS fix, drawn as a blue dot (like showsUserLocation). */
  deviceLatitude?: number;
  deviceLongitude?: number;
  /** While true, the map recenters on the shared location on every update. */
  following: boolean;
  /** Fired once when the user pans the map away; parent should set following=false. */
  onUserPan?: () => void;
}

const LEAFLET_VERSION = '1.9.4';
/** If Leaflet cannot report ready within this window (e.g. no internet for the
 *  CDN), fall back to the coordinates card instead of a dark rectangle. */
const READY_TIMEOUT_MS = 10_000;

const MAP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #1A1A2E; }
  #map { height: 100%; width: 100%; background: #1A1A2E; }
  .leaflet-container { font: inherit; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js"></script>
<script>
(function () {
  var map = L.map('map', { zoomControl: false }).setView([20, 0], 2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  var sharedMarker = null; // pin — last location shared with trusted contacts
  var deviceDot = null;    // blue dot — this device's live GPS fix
  var follow = true;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Panning away pauses auto-following; the native side offers a "Recenter" button.
  map.on('dragstart', function () {
    follow = false;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'userpan' }));
    }
  });

  window.__safelink = {
    init: function (lat, lng) {
      map.setView([lat, lng], 16);
    },
    setShared: function (lat, lng, title, desc) {
      if (sharedMarker) sharedMarker.remove();
      var icon = L.divIcon({
        className: 'safelink-pin',
        html: '<div style="font-size:34px;line-height:34px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.5));">&#128205;</div>',
        iconSize: [34, 34],
        iconAnchor: [17, 32],
        popupAnchor: [0, -30]
      });
      sharedMarker = L.marker([lat, lng], { icon: icon, title: title }).addTo(map);
      var popupHtml = '';
      if (title) popupHtml += '<b>' + escapeHtml(title) + '</b>';
      if (desc) popupHtml += (popupHtml ? '<br>' : '') + escapeHtml(desc);
      if (popupHtml) sharedMarker.bindPopup(popupHtml);
      if (follow) map.setView([lat, lng], map.getZoom());
    },
    setDevice: function (lat, lng) {
      if (deviceDot) deviceDot.remove();
      deviceDot = L.circleMarker([lat, lng], {
        radius: 7, color: '#fff', weight: 2, fillColor: '#2A93EE', fillOpacity: 1
      }).addTo(map);
    },
    recenter: function (lat, lng) {
      follow = true;
      map.setView([lat, lng], Math.max(map.getZoom(), 16));
    }
  };

  // Leaflet (and therefore __safelink) is fully loaded — tell React Native.
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
  }
})();
</script>
</body>
</html>`;

export default function OsmMapView({
  latitude,
  longitude,
  title,
  description,
  deviceLatitude,
  deviceLongitude,
  following,
  onUserPan,
}: OsmMapViewProps) {
  const webRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Leaflet signals readiness via postMessage; if it never arrives (offline CDN,
  // slow network) degrade gracefully instead of showing a blank rectangle.
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setFailed(true), READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready]);

  const inject = (js: string) => {
    webRef.current?.injectJavaScript(`window.__safelink && ${js}; true;`);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg?.type === 'ready') setReady(true);
      else if (msg?.type === 'userpan') onUserPan?.();
    } catch {
      /* ignore malformed messages from the page */
    }
  };

  // Center the map the moment Leaflet is ready (initial view + zoom).
  useEffect(() => {
    if (!ready) return;
    inject(`window.__safelink.init(${latitude}, ${longitude})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Shared-location pin — moves with every fix the Emergency Engine reports.
  useEffect(() => {
    if (!ready) return;
    inject(
      `window.__safelink.setShared(${latitude}, ${longitude}, ${JSON.stringify(title ?? '')}, ${JSON.stringify(description ?? '')})`
    );
  }, [ready, latitude, longitude, title, description]);

  // Device GPS blue dot (own watcher in the parent screen).
  useEffect(() => {
    if (!ready || deviceLatitude == null || deviceLongitude == null) return;
    inject(`window.__safelink.setDevice(${deviceLatitude}, ${deviceLongitude})`);
  }, [ready, deviceLatitude, deviceLongitude]);

  // Resume following when the parent re-enables it (Recenter button).
  useEffect(() => {
    if (!ready || !following) return;
    inject(`window.__safelink.recenter(${latitude}, ${longitude})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, following]);

  if (failed) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackIcon}>🗺</Text>
        <Text style={styles.fallbackTitle}>Map unavailable</Text>
        <Text style={styles.fallbackNote}>
          OpenStreetMap tiles need an internet connection. Your live coordinates are shown below.
        </Text>
      </View>
    );
  }

  return (
    <WebView
      ref={webRef}
      source={{ html: MAP_HTML }}
      originWhitelist={['*']}
      style={StyleSheet.absoluteFill}
      javaScriptEnabled
      setSupportMultipleWindows={false}
      onMessage={onMessage}
      renderError={() => (
        <View style={styles.fallback}>
          <Text style={styles.fallbackTitle}>Map failed to load</Text>
          <Text style={styles.fallbackNote}>Check your internet connection and reopen this screen.</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.darkBg,
    padding: 24,
  },
  fallbackIcon: { fontSize: 48, marginBottom: 10 },
  fallbackTitle: { fontSize: 16, fontWeight: '700', color: Colors.darkText },
  fallbackNote: { fontSize: 13, color: Colors.darkTextSecondary, marginTop: 8, textAlign: 'center' },
});
