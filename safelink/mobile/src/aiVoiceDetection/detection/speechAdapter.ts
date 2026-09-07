/**
 * Speech-recognition adapter — the single native dependency of this module.
 *
 * Wraps `expo-speech-recognition` (jamsch) behind a small, safe interface:
 *   • optional-require so a missing native module (Expo Go / web) NEVER crashes the app
 *   • continuous recognition with interim results and a volume stream on one mic
 *   • resilient auto-restart when the OS recognizer ends after silence
 *
 * If the native module isn't present, `isAvailable()` returns false and the controller
 * surfaces an honest "requires a development build" state — manual SOS is unaffected.
 *
 * Full functionality requires a custom dev build (see app.json plugin + README).
 */

export interface SpeechResultEvent {
  transcript: string;
  confidence?: number; // 0–1 when supplied by the engine
  isFinal: boolean;
}

export interface SpeechAdapterHandlers {
  onResult: (e: SpeechResultEvent) => void;
  onVolume: (rawLevel: number) => void;
  onError: (code: string, message: string) => void;
  onEnd: () => void;
  onStart: () => void;
}

export interface StartOptions {
  lang: string;
  contextualStrings: string[];
  volumeIntervalMs: number;
}

// Optional require: bundlers keep this out of the way and a missing module is caught.
let mod: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mod = require('expo-speech-recognition');
} catch {
  mod = null;
}

const RecognitionModule = mod?.ExpoSpeechRecognitionModule ?? null;

type Sub = { remove: () => void } | null;

export class SpeechAdapter {
  private subs: Sub[] = [];
  private running = false;

  /** Whether the native speech module is linked in this build. */
  isAvailable(): boolean {
    return !!RecognitionModule && typeof RecognitionModule.start === 'function';
  }

  /** Request mic + speech-recognition permission. Returns true only if granted. */
  async requestPermissions(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await RecognitionModule.requestPermissionsAsync();
      return !!(res?.granted ?? res?.status === 'granted');
    } catch {
      return false;
    }
  }

  private addListener(event: string, cb: (e: any) => void): void {
    try {
      const sub = RecognitionModule.addListener(event, cb);
      if (sub) this.subs.push(sub);
    } catch {
      /* event not supported on this platform — ignore */
    }
  }

  /** Begin continuous recognition. Throws are caught and reported via onError. */
  start(opts: StartOptions, handlers: SpeechAdapterHandlers): void {
    if (!this.isAvailable()) {
      handlers.onError('not-available', 'Speech recognition native module is not available.');
      return;
    }
    this.stopListeners();

    this.addListener('result', (e: any) => {
      const best = e?.results?.[0];
      handlers.onResult({
        transcript: best?.transcript ?? '',
        confidence: typeof best?.confidence === 'number' ? best.confidence : undefined,
        isFinal: !!e?.isFinal,
      });
    });
    this.addListener('volumechange', (e: any) => {
      const v = typeof e?.value === 'number' ? e.value : Number(e?.value);
      if (!Number.isNaN(v)) handlers.onVolume(v);
    });
    this.addListener('error', (e: any) => {
      handlers.onError(String(e?.error ?? 'error'), String(e?.message ?? 'Recognition error'));
    });
    this.addListener('end', () => {
      this.running = false;
      handlers.onEnd();
    });
    this.addListener('start', () => {
      this.running = true;
      handlers.onStart();
    });

    try {
      RecognitionModule.start({
        lang: opts.lang,
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: false,
        addsPunctuation: false,
        contextualStrings: opts.contextualStrings,
        volumeChangeEventOptions: { enabled: true, intervalMillis: opts.volumeIntervalMs },
      });
      this.running = true;
    } catch (err: any) {
      handlers.onError('start-failed', err?.message ?? 'Could not start recognition.');
    }
  }

  /** Stop recognition and remove listeners. Safe to call repeatedly. */
  stop(): void {
    if (this.isAvailable()) {
      try {
        RecognitionModule.stop();
      } catch {
        try {
          RecognitionModule.abort?.();
        } catch {
          /* ignore */
        }
      }
    }
    this.running = false;
    this.stopListeners();
  }

  private stopListeners(): void {
    for (const s of this.subs) {
      try {
        s?.remove();
      } catch {
        /* ignore */
      }
    }
    this.subs = [];
  }

  get isRunning(): boolean {
    return this.running;
  }
}
