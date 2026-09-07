import axios from 'axios';
import { logger } from '../utils/logger';

/**
 * Free, key-less map services — no Google Maps, no API keys, no billing:
 *
 *  - Routing:      OSRM public demo server (router.project-osrm.org)
 *  - Geocoding:    Nominatim (nominatim.openstreetmap.org)
 *
 * Both are open OpenStreetMap-based services. The OSRM demo server only
 * exposes the car profile, so routes are computed on the road network and
 * walking/bicycling ETAs are estimated from the real distance (see below).
 */

const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/driving';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

/** Nominatim's usage policy requires a descriptive User-Agent header. */
const HEADERS = { 'User-Agent': 'SafeLink/1.0 (personal safety app)' };

/** Average speeds (m/s) used to estimate non-driving ETAs from real distance. */
const MODE_SPEED_MPS: Record<string, number> = {
  walking: 1.4,   // ≈ 5 km/h
  bicycling: 5.5, // ≈ 20 km/h
};

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  polyline: string;
  eta: Date;
}

export const calculateRoute = async (
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  mode: string = 'driving'
): Promise<RouteResult> => {
  try {
    // OSRM expects {longitude},{latitude} pairs, overview=full + polyline
    // geometry (the same encoding the Journey model already stores).
    const response = await axios.get(
      `${OSRM_BASE_URL}/${originLng},${originLat};${destLng},${destLat}`,
      {
        params: { overview: 'full', geometries: 'polyline' },
        headers: HEADERS,
        timeout: 8000,
      }
    );

    const data = response.data;
    if (data.code !== 'Ok' || !data.routes?.length) {
      throw new Error(`OSRM routing error: ${data.code ?? 'no route'}`);
    }

    const route = data.routes[0];
    const distanceMeters = route.distance as number;

    // The public OSRM server routes with the car profile. For other travel
    // modes, estimate the ETA from the real road distance at a typical speed
    // (transit keeps the driving estimate — no sensible free approximation).
    const durationSeconds =
      mode in MODE_SPEED_MPS
        ? Math.round(distanceMeters / MODE_SPEED_MPS[mode])
        : (route.duration as number);
    const eta = new Date(Date.now() + durationSeconds * 1000);

    return {
      distanceMeters,
      durationSeconds,
      polyline: route.geometry as string,
      eta,
    };
  } catch (error) {
    logger.error('Maps service error (calculateRoute):', error);
    throw error;
  }
};

export const getAddressFromCoords = async (
  latitude: number,
  longitude: number
): Promise<string> => {
  try {
    const response = await axios.get(NOMINATIM_URL, {
      params: {
        format: 'jsonv2',
        lat: latitude,
        lon: longitude,
        zoom: 18, // house/building-level detail when available
      },
      headers: HEADERS,
      timeout: 5000,
    });

    if (response.data?.display_name) {
      return response.data.display_name as string;
    }
    return 'Location unavailable';
  } catch (error) {
    logger.error('Maps service error (geocode):', error);
    return 'Location unavailable';
  }
};

// Haversine formula — distance in meters between two GPS points
export const haversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
