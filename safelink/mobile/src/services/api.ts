import axios from 'axios';

import { getIdToken } from './auth.service';

/**
 * Single axios instance for every SafeLink backend call.
 *
 * Android Emulator:
 * 10.0.2.2 points to the host computer's localhost.
 *
 * SafeLink backend:
 * http://10.0.2.2:5000/api
 */

// IMPORTANT:
// This is intentionally hardcoded for the Android Studio emulator.
// Do not use EXPO_PUBLIC_API_URL here for this build.
export const API_BASE_URL = 'http://192.168.0.107:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach the current Firebase ID token to every request.
api.interceptors.request.use(async (config) => {
  try {
    const token = await getIdToken();

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (e) {
    console.warn('Could not attach Firebase token:', e);
  }

  return config;
});

// Normalize backend/network errors.
api.interceptors.response.use(
  (response) => response,

  (error) => {
    const isNetwork = !error.response;
    const status = error.response?.status as number | undefined;
    const serverMessage = error.response?.data?.error as string | undefined;

    let message: string;

    if (isNetwork) {
      message =
        'Cannot connect to the SafeLink backend. ' +
        `Backend URL: ${API_BASE_URL}. ` +
        'Make sure the backend server is running on port 5000.';
    } else if (serverMessage) {
      message = `HTTP ${status} — ${serverMessage}`;
    } else {
      message = `HTTP ${status ?? '?'} — ${
        error.message || 'Request failed'
      }`;
    }

    const wrapped = new Error(message) as Error & {
      isNetworkError?: boolean;
      status?: number;
      responseBody?: unknown;
    };

    wrapped.isNetworkError = isNetwork;
    wrapped.status = status;
    wrapped.responseBody = error.response?.data;

    return Promise.reject(wrapped);
  }
);

// ─── Auth ─────────────────────────────────────────────────────────────────

export const authAPI = {
  register: (data: {
    name: string;
    email: string;
    phone: string;
    firebaseIdToken: string;
  }) => api.post('/auth/register', data),

  login: (data: {
    firebaseIdToken: string;
    fcmToken?: string;
  }) => api.post('/auth/login', data),

  logout: () => api.post('/auth/logout'),
};

// ─── User ─────────────────────────────────────────────────────────────────

export const userAPI = {
  getMe: () => api.get('/users/me'),

  updateMe: (
    data: Partial<{
      name: string;
      phone: string;
      profileImage: string;
      fcmToken: string;
      emergencyPreferences: object;
      aiSettings: object;
      privacySettings: object;
    }>
  ) => api.put('/users/me', data),
};

// ─── Contacts ─────────────────────────────────────────────────────────────

export const contactsAPI = {
  getAll: () => api.get('/contacts'),

  create: (data: {
    name: string;
    phone: string;
    email?: string;
    relationship: string;
    priority?: number;
  }) => api.post('/contacts', data),

  update: (id: string, data: object) =>
    api.put(`/contacts/${id}`, data),

  delete: (id: string) =>
    api.delete(`/contacts/${id}`),
};

// ─── Emergency ────────────────────────────────────────────────────────────

export const emergencyAPI = {
  activate: (data: {
    type?: string;
    latitude?: number;
    longitude?: number;
    riskLevel?: string;
    aiEventId?: string;
    journeyId?: string;
  }) => api.post('/emergencies', data),

  getActive: () =>
    api.get('/emergencies/active'),

  get: (id: string) =>
    api.get(`/emergencies/${id}`),

  resolve: (id: string) =>
    api.put(`/emergencies/${id}/resolve`),

  cancel: (id: string) =>
    api.post(`/emergencies/${id}/cancel`),

  updateLocation: (
    id: string,
    data: {
      latitude: number;
      longitude: number;
      accuracy?: number;
      speed?: number;
      direction?: number;
    }
  ) => api.post(`/emergencies/${id}/location`, data),

  getLocation: (id: string) =>
    api.get(`/emergencies/${id}/location`),
};

// ─── Journeys ─────────────────────────────────────────────────────────────

export const journeyAPI = {
  create: (data: object) =>
    api.post('/journeys', data),

  getAll: () =>
    api.get('/journeys'),

  get: (id: string) =>
    api.get(`/journeys/${id}`),

  start: (id: string) =>
    api.post(`/journeys/${id}/start`),

  end: (id: string) =>
    api.post(`/journeys/${id}/end`),

  reportDeviation: (
    id: string,
    data: {
      latitude: number;
      longitude: number;
    }
  ) =>
    api.post(`/journeys/${id}/deviation`, data),
};

// ─── AI Detection ─────────────────────────────────────────────────────────

export const aiAPI = {
  logDetection: (data: object) =>
    api.post('/ai/detection', data),

  respondToDetection: (
    id: string,
    actionTaken: 'SOS_ACTIVATED' | 'CANCELLED'
  ) =>
    api.put(`/ai/detection/${id}/respond`, {
      actionTaken,
    }),

  getSettings: () =>
    api.get('/ai/settings'),

  updateSettings: (data: object) =>
    api.put('/ai/settings', data),
};

// ─── Recordings ───────────────────────────────────────────────────────────

export const recordingAPI = {
  create: (emergencyId: string) =>
    api.post(`/emergencies/${emergencyId}/recordings/session`),

  uploadMultipart: (emergencyId: string, recordingId: string, chunk: { uri: string; index: number; durationSeconds: number }) => {
    const form = new FormData();
    form.append('recordingId', recordingId);
    form.append('chunkIndex', String(chunk.index));
    form.append('durationSeconds', String(chunk.durationSeconds));
    form.append('audio', { uri: chunk.uri, name: `segment_${String(chunk.index).padStart(8, '0')}.m4a`, type: 'audio/mp4' } as any);
    return api.post(`/emergencies/${emergencyId}/recordings`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  getAll: (emergencyId: string) =>
    api.get(`/emergencies/${emergencyId}/recordings`),

  update: (id: string, data: object) =>
    api.put(`/recordings/${id}`, data),

  retryUpload: (id: string) =>
    api.post(`/recordings/${id}/retry-upload`),

  createChunk: (id: string, data: { index: number; contentType: string }) =>
    api.post(`/recordings/${id}/chunks`, data),

  confirmChunk: (id: string, index: number, data: { sizeBytes: number; durationSeconds: number }) =>
    api.post(`/recordings/${id}/chunks/${index}/confirm`, data),

  finalize: (id: string) =>
    api.post(`/recordings/${id}/finalize`),
};

// ─── History ──────────────────────────────────────────────────────────────

export const historyAPI = {
  getAll: (page = 1) =>
    api.get('/history', {
      params: { page },
    }),

  get: (id: string) =>
    api.get(`/history/${id}`),
};

// ─── Safety Timer ─────────────────────────────────────────────────────────

export const timerAPI = {
  create: (data: {
    durationSeconds: number;
    note?: string;
    destination?: string;
    responseGracePeriodSeconds?: number;
    latitude?: number;
    longitude?: number;
  }) =>
    api.post('/timers', data),

  getActive: () =>
    api.get('/timers/active'),

  extend: (
    id: string,
    additionalSeconds: number
  ) =>
    api.put(`/timers/${id}/extend`, {
      additionalSeconds,
    }),

  resolve: (id: string) =>
    api.put(`/timers/${id}/resolve`),

  escalate: (
    id: string,
    data: {
      latitude?: number;
      longitude?: number;
    } = {}
  ) =>
    api.post(`/timers/${id}/escalate`, data),

  cancel: (id: string) =>
    api.delete(`/timers/${id}`),
};

export default api;