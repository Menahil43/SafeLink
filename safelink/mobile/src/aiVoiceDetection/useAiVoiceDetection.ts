/**
 * useAiVoiceDetection — React binding for the AI Voice Detection module.
 *
 * Subscribes to the module store and exposes the controller's actions. Components use
 * this instead of touching the controller/store directly, keeping the module's public
 * surface small.
 */

import { useCallback } from 'react';
import { useAiVoiceStore } from './aiVoiceStore';
import { aiVoiceController } from './AiVoiceDetectionController';

export const useAiVoiceDetection = () => {
  const enabled = useAiVoiceStore((s) => s.enabled);
  const status = useAiVoiceStore((s) => s.status);
  const statusDetail = useAiVoiceStore((s) => s.statusDetail);
  const micPermission = useAiVoiceStore((s) => s.micPermission);
  const speechAvailable = useAiVoiceStore((s) => s.speechAvailable);
  const acousticAvailable = useAiVoiceStore((s) => s.acousticAvailable);
  const currentLevel = useAiVoiceStore((s) => s.currentLevel);
  const lastTranscript = useAiVoiceStore((s) => s.lastTranscript);
  const lastResult = useAiVoiceStore((s) => s.lastResult);
  const activeAlert = useAiVoiceStore((s) => s.activeAlert);
  const log = useAiVoiceStore((s) => s.log);

  const enable = useCallback(() => aiVoiceController.enable(), []);
  const disable = useCallback(() => aiVoiceController.disable(), []);
  const toggle = useCallback(
    () => (useAiVoiceStore.getState().enabled ? aiVoiceController.disable() : aiVoiceController.enable()),
    []
  );
  const escalateNow = useCallback(() => aiVoiceController.escalate('manual'), []);
  const cancelAlert = useCallback(() => aiVoiceController.cancelAlert(), []);
  const refreshConfig = useCallback(() => aiVoiceController.refreshConfig(), []);
  const clearLog = useCallback(() => useAiVoiceStore.getState().clearLog(), []);

  return {
    // state
    enabled,
    status,
    statusDetail,
    micPermission,
    speechAvailable,
    acousticAvailable,
    supported: aiVoiceController.isSupported(),
    currentLevel,
    lastTranscript,
    lastResult,
    activeAlert,
    log,
    // actions
    enable,
    disable,
    toggle,
    escalateNow,
    cancelAlert,
    refreshConfig,
    clearLog,
  };
};
