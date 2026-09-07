import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import AudioModule from 'expo-audio/build/AudioModule';
import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useStore } from '../store';

export interface RecordingHandle {
  recordingId: string;
  emergencyId: string;
  startedAt: number;
}

export interface LocalRecordingMetadata {
  recordingId: string;
  emergencyId: string;
  localUri: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  duration: number;
  createdAt: string;
  status: 'saved' | 'failed';
}

interface Segment {
  uri: string;
  index: number;
  durationSeconds: number;
  sizeBytes: number;
}

const SEGMENT_SECONDS = 30;
const RECORDINGS_KEY = 'safelink.localRecordings';
let active: RecordingHandle | null = null;
let recorder: InstanceType<typeof AudioModule.AudioRecorder> | null = null;
let stopping = false;
let loopPromise: Promise<void> | null = null;
let savedIndexes = new Set<number>();

const nativeRecorder = NativeModules.SafeLinkEmergencyRecording as {
  start: (recordingId: string, segmentSeconds: number) => Promise<void>;
  stop: () => Promise<void>;
  getCompletedSegments: (recordingId: string) => Promise<Segment[]>;
  getStatus: () => Promise<{ recording: boolean; initFailed?: boolean; error?: string; bytesWritten?: number }>;
} | undefined;

const setState = (state: Parameters<ReturnType<typeof useStore.getState>['setRecordingState']>[0]) =>
  useStore.getState().setRecordingState(state);
const localId = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const readMetadata = async (): Promise<LocalRecordingMetadata[]> => {
  try { return JSON.parse(await AsyncStorage.getItem(RECORDINGS_KEY) || '[]') as LocalRecordingMetadata[]; } catch { return []; }
};
const writeMetadata = async (items: LocalRecordingMetadata[]) => {
  await AsyncStorage.setItem(RECORDINGS_KEY, JSON.stringify(items));
};

const saveSegment = async (segment: Segment) => {
  if (!active || savedIndexes.has(segment.index)) return;
  const info = await FileSystem.getInfoAsync(segment.uri).catch(() => ({ exists: false, size: 0 }));
  if (!info.exists || !info.size) throw new Error('Recording segment is missing or empty.');
  const items = await readMetadata();
  const metadata: LocalRecordingMetadata = {
    recordingId: `${active.recordingId}-${segment.index}`,
    emergencyId: active.emergencyId,
    localUri: segment.uri,
    fileName: `segment-${String(segment.index + 1).padStart(3, '0')}.wav`,
    contentType: 'audio/wav', fileSize: info.size, duration: segment.durationSeconds,
    createdAt: new Date().toISOString(), status: 'saved',
  };
  await writeMetadata([metadata, ...items]);
  savedIndexes.add(segment.index);
  setState({ recordingUploadedChunks: savedIndexes.size, recordingStatus: 'completed' });
  console.info('[SafeLink recording] saved on device', { recordingId: metadata.recordingId, uri: metadata.localUri, sizeBytes: metadata.fileSize });
};

const collectNativeSegments = async () => {
  if (!active || !nativeRecorder) return;
  const segments = await nativeRecorder.getCompletedSegments(active.recordingId);
  for (const segment of segments) await saveSegment(segment);
};

const recordLoop = async () => {
  if (Platform.OS === 'android') {
    if (!nativeRecorder) throw new Error('Native recording service unavailable. Rebuild the development APK.');
    while (active && !stopping) {
      try {
        await collectNativeSegments();
        const status = await nativeRecorder.getStatus();
        if (!status.recording) {
          setState({ recordingStatus: 'failed', recordingError: status.error || 'Native recorder stopped.' });
          return;
        }
        setState({ recordingStatus: 'recording', recordingDurationSeconds: Math.floor((Date.now() - active.startedAt) / 1000) });
      } catch {
        setState({ recordingStatus: 'failed' });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return;
  }

  while (active && !stopping) {
    const current = new AudioModule.AudioRecorder(RecordingPresets.LOW_QUALITY);
    recorder = current;
    try {
      await current.prepareToRecordAsync();
      current.record({ forDuration: SEGMENT_SECONDS });
      setState({ recordingStatus: 'recording' });
      while (current.isRecording && active && !stopping) {
        setState({ recordingDurationSeconds: Math.floor((Date.now() - active.startedAt) / 1000) });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (current.isRecording) await current.stop();
      const uri = current.uri;
      if (!uri || !FileSystem.documentDirectory) throw new Error('Recorder produced no file.');
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || !info.size) throw new Error('Recorder produced an empty file.');
      const directory = `${FileSystem.documentDirectory}SafeLink/recordings/${active.emergencyId}/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const destination = `${directory}segment-${Date.now()}.m4a`;
      await FileSystem.copyAsync({ from: uri, to: destination });
      const saved = await FileSystem.getInfoAsync(destination);
      if (!saved.exists || !saved.size) throw new Error('Persistent recording copy failed.');
      const items = await readMetadata();
      await writeMetadata([{
        recordingId: localId(), emergencyId: active.emergencyId, localUri: destination,
        fileName: destination.split('/').pop() || 'recording.m4a', contentType: 'audio/mp4',
        fileSize: saved.size, duration: current.currentTime, createdAt: new Date().toISOString(), status: 'saved',
      }, ...items]);
      await FileSystem.deleteAsync(uri, { idempotent: true });
      setState({ recordingStatus: 'completed', recordingUploadedChunks: useStore.getState().recordingUploadedChunks + 1 });
    } catch {
      setState({ recordingStatus: 'failed' });
      if (active && !stopping) await new Promise((resolve) => setTimeout(resolve, 5000));
    } finally { recorder = null; }
  }
};

export const recordingService = {
  isEnabled: true as const,

  async start(emergencyId: string): Promise<RecordingHandle | null> {
    if (active) return active;
    if (useStore.getState().user?.privacySettings?.shareRecordings !== true) {
      setState({ recordingStatus: 'not_started' }); return null;
    }
    setState({ recordingStatus: 'requesting_permission' });
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) { setState({ recordingStatus: 'permission_denied', recordingError: 'Microphone permission was denied.' }); return null; }
    const handle = { recordingId: localId(), emergencyId, startedAt: Date.now() };
    active = handle; stopping = false; savedIndexes = new Set<number>();
    console.info('[SafeLink recording] startRecording() called', { recordingId: handle.recordingId });
    try {
      if (Platform.OS === 'android') {
        if (!nativeRecorder) throw new Error('Native recording service unavailable. Rebuild the development APK.');
        // COMMAND START: deliver the ACTION_START intent to the native service.
        // The service sets captureActive=true synchronously inside onStartCommand,
        // so we no longer poll getStatus() here — that poll raced the recording
        // thread (which hadn't set captureActive yet) and triggered a corrective
        // STOP that tore down a healthy recorder.
        await nativeRecorder.start(handle.recordingId, SEGMENT_SECONDS);
      } else {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: true });
      }
      setState({ recordingStatus: 'recording', recordingDurationSeconds: 0, recordingUploadedChunks: 0, recordingError: null });
      loopPromise = recordLoop();
      console.info('[SafeLink recording] recording started', { recordingId: handle.recordingId });
      return handle;
    } catch (error) {
      console.warn('[SafeLink recording] start failed', { message: (error as Error).message });
      if (Platform.OS === 'android') await nativeRecorder?.stop().catch(() => undefined);
      active = null; loopPromise = null; setState({ recordingStatus: 'failed', recordingError: (error as Error).message });
      return null;
    }
  },

  async stop(handle: RecordingHandle | null): Promise<void> {
    if (!handle || !active || handle.recordingId !== active.recordingId) return;
    stopping = true;
    console.info('[SafeLink recording] stopRecording() called', { recordingId: handle.recordingId });
    if (Platform.OS === 'android') {
      // COMMAND STOP: deliver the ACTION_STOP intent to the native service.
      await nativeRecorder?.stop().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await collectNativeSegments().catch(() => undefined);
    } else if (recorder?.isRecording) await recorder.stop().catch(() => undefined);
    await loopPromise?.catch(() => undefined);
    if (savedIndexes.size > 0) setState({ recordingStatus: 'completed' });
    active = null; recorder = null; loopPromise = null;
    console.info('[SafeLink recording] recording finalized locally', { recordingId: handle.recordingId, savedSegments: savedIndexes.size });
  },

  listLocalRecordings: async (): Promise<LocalRecordingMetadata[]> => {
    const items = await readMetadata();
    const valid: LocalRecordingMetadata[] = [];
    for (const item of items) {
      const info = await FileSystem.getInfoAsync(item.localUri).catch(() => ({ exists: false }));
      if (info.exists && item.fileSize > 0) valid.push(item);
    }
    if (valid.length !== items.length) await writeMetadata(valid);
    return valid;
  },

  deleteLocalRecording: async (recordingId: string): Promise<boolean> => {
    const items = await readMetadata();
    const item = items.find((entry) => entry.recordingId === recordingId);
    if (!item) return false;
    await FileSystem.deleteAsync(item.localUri, { idempotent: true });
    await writeMetadata(items.filter((entry) => entry.recordingId !== recordingId));
    return true;
  },

  statusLabel(): string {
    const state = useStore.getState().recordingStatus;
    if (state === 'recording') return 'Recording';
    if (state === 'completed') return 'Saved on device';
    if (state === 'not_started') return 'Not started';
    if (state === 'permission_denied') return 'Permission denied';
    return state.replace('_', ' ');
  },
};
