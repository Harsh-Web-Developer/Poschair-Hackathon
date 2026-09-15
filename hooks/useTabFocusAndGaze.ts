'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface TabSwitchViolationEvent {
  id: string;
  timestamp: number;
  type: 'VISIBILITY_HIDDEN' | 'WINDOW_BLUR';
  durationHiddenSec: number;
  details: string;
  structuredLog: {
    isCheating: boolean;
    direction: string;
    confidence: number;
    event: string;
    timestamp: number;
    backgroundTrackingActive: boolean;
    details?: string;
  };
}

export interface UseTabFocusAndGazeOptions {
  /**
   * Callback invoked on every tick while the tab is in the background
   * (driven by Web Worker so frame processing doesn't throttle to 0 FPS)
   */
  onBackgroundTick?: () => void;

  /** Callback fired immediately when an unsanctioned tab switch or window blur occurs */
  onTabSwitchViolation?: (event: TabSwitchViolationEvent) => void;

  /** Callback fired when the user returns to the tab */
  onReentry?: (durationHiddenSec: number) => void;

  /** Optional calibration callback to re-zero eye gaze & posture */
  onCalibrate?: () => void;

  /** Structured audit logger */
  logAuditEvent?: (
    code: string,
    severity: 'LOW' | 'MEDIUM' | 'CRITICAL',
    title: string,
    details: string,
    durationSec?: number,
    structuredJson?: any
  ) => void;

  /** Whether the proctoring camera is actively running */
  isCameraActive?: boolean;

  /** Whether audio alerts should be silenced */
  audioMuted?: boolean;
}

export interface UseTabFocusAndGazeReturn {
  isTabVisible: boolean;
  isWindowFocused: boolean;
  isBackgroundRunning: boolean;
  tabSwitchCount: number;
  currentAwayDurationSec: number;
  lastAwayDurationSec: number;
  reentryModalOpen: boolean;
  lastViolationEvent: TabSwitchViolationEvent | null;
  playTabSwitchAlarm: () => void;
  dismissReentryAndCalibrate: (customCalibrate?: () => void) => void;
  startBackgroundTicker: (callback?: () => void) => void;
  stopBackgroundTicker: () => void;
  resetTabMetrics: () => void;
}

/**
 * Complete React hook handling Browser Page Visibility API, unsanctioned
 * tab switches/blur detection, continuous background camera stream processing
 * via off-screen Web Worker ticks, and re-entry gaze recalibration validation.
 */
export function useTabFocusAndGaze({
  onBackgroundTick,
  onTabSwitchViolation,
  onReentry,
  onCalibrate,
  logAuditEvent,
  isCameraActive = true,
  audioMuted = false,
}: UseTabFocusAndGazeOptions = {}): UseTabFocusAndGazeReturn {
  // Primary visibility & focus states
  const [isTabVisible, setIsTabVisible] = useState<boolean>(true);
  const [isWindowFocused, setIsWindowFocused] = useState<boolean>(true);
  const [isBackgroundRunning, setIsBackgroundRunning] = useState<boolean>(false);
  const [tabSwitchCount, setTabSwitchCount] = useState<number>(0);
  const [currentAwayDurationSec, setCurrentAwayDurationSec] = useState<number>(0);
  const [lastAwayDurationSec, setLastAwayDurationSec] = useState<number>(0);
  const [reentryModalOpen, setReentryModalOpen] = useState<boolean>(false);
  const [lastViolationEvent, setLastViolationEvent] = useState<TabSwitchViolationEvent | null>(null);

  // References
  const switchStartTimeRef = useRef<number | null>(null);
  const awayTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const fallbackIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const violationTriggeredInCurrentSwitchRef = useRef<boolean>(false);
  const tickCallbackRef = useRef<(() => void) | undefined>(onBackgroundTick);

  // Keep latest callback ref updated to prevent stale closures
  useEffect(() => {
    tickCallbackRef.current = onBackgroundTick;
  }, [onBackgroundTick]);

  // ── 1. Web Audio Alarm Synthesizer (Instant Warble Alert) ─────────────────
  const playTabSwitchAlarm = useCallback(() => {
    if (audioMuted) return;
    try {
      if (typeof window === 'undefined') return;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // High-urgency dual-tone siren pattern
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(987.77, now); // B5
      osc.frequency.setValueAtTime(659.25, now + 0.12); // E5
      osc.frequency.setValueAtTime(987.77, now + 0.24); // B5
      osc.frequency.setValueAtTime(659.25, now + 0.36); // E5
      osc.frequency.setValueAtTime(987.77, now + 0.48); // B5

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.66);

      // Add a sub-harmonic punch for piercing presence
      const subOsc = ctx.createOscillator();
      const subGain = ctx.createGain();
      subOsc.type = 'square';
      subOsc.frequency.setValueAtTime(220, now);
      subGain.gain.setValueAtTime(0.2, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      subOsc.connect(subGain);
      subGain.connect(ctx.destination);
      subOsc.start(now);
      subOsc.stop(now + 0.36);
    } catch (err) {
      console.warn('Audio alarm alert error:', err);
    }
  }, [audioMuted]);

  // ── 2. Off-Screen Web Worker Ticker (Bypasses Browser 0 FPS Throttling) ────
  // Browsers aggressively clamp setInterval down to 1000ms and halt requestAnimationFrame to 0 FPS.
  // Dedicated Web Workers run in a distinct OS thread and maintain un-throttled ~20-30 FPS tick intervals!
  const startBackgroundTicker = useCallback((callback?: () => void) => {
    if (callback) {
      tickCallbackRef.current = callback;
    }

    setIsBackgroundRunning(true);

    if (workerRef.current) {
      workerRef.current.postMessage('START');
    } else {
      try {
        const workerScript = `
          let timer = null;
          self.onmessage = function(e) {
            if (e.data === 'START') {
              if (!timer) {
                // 20 FPS off-screen background tick (50ms interval)
                timer = setInterval(function() {
                  self.postMessage('TICK');
                }, 50);
              }
            } else if (e.data === 'STOP') {
              if (timer) {
                clearInterval(timer);
                timer = null;
              }
            }
          };
        `;
        const blob = new Blob([workerScript], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);

        worker.onmessage = (e) => {
          if (e.data === 'TICK') {
            if (tickCallbackRef.current) {
              try {
                tickCallbackRef.current();
              } catch (err) {
                console.error('Error during background frame processing tick:', err);
              }
            }
          }
        };

        workerRef.current = worker;
        worker.postMessage('START');
      } catch (workerErr) {
        console.warn('Web Worker creation failed, falling back to interval timer:', workerErr);
        // Fallback interval if Worker creation is restricted
        if (!fallbackIntervalRef.current) {
          fallbackIntervalRef.current = setInterval(() => {
            if (tickCallbackRef.current) {
              tickCallbackRef.current();
            }
          }, 60);
        }
      }
    }
  }, []);

  const stopBackgroundTicker = useCallback(() => {
    setIsBackgroundRunning(false);

    if (workerRef.current) {
      try {
        workerRef.current.postMessage('STOP');
      } catch (e) {
        // ignore
      }
    }

    if (fallbackIntervalRef.current) {
      clearInterval(fallbackIntervalRef.current);
      fallbackIntervalRef.current = null;
    }
  }, []);

  // ── 3. Handle Tab Switch & Browser Unfocus (Immediate Violation) ───────────
  const triggerTabSwitchViolation = useCallback(
    (source: 'VISIBILITY_HIDDEN' | 'WINDOW_BLUR') => {
      // Avoid duplicate trigger if both blur and visibilitychange occur in the same millisecond
      if (violationTriggeredInCurrentSwitchRef.current) return;
      violationTriggeredInCurrentSwitchRef.current = true;

      const now = Date.now();
      switchStartTimeRef.current = now;

      // Start ticker counting away duration
      if (awayTimerIntervalRef.current) clearInterval(awayTimerIntervalRef.current);
      awayTimerIntervalRef.current = setInterval(() => {
        if (switchStartTimeRef.current) {
          setCurrentAwayDurationSec(
            Math.round(((Date.now() - switchStartTimeRef.current) / 1000) * 10) / 10
          );
        }
      }, 100);

      // Play immediate acoustic violation alarm
      playTabSwitchAlarm();

      // Start continuous background frame tracking immediately
      startBackgroundTicker();

      // Increment tab switch count
      setTabSwitchCount((prev) => prev + 1);

      const eventPayload: TabSwitchViolationEvent = {
        id: `tab-switch-${now}-${Math.random().toString(36).substr(2, 6)}`,
        timestamp: now,
        type: source,
        durationHiddenSec: 0,
        details:
          source === 'VISIBILITY_HIDDEN'
            ? 'Tab switched or browser minimized. Background eye-gaze and posture sentry actively processing.'
            : 'Application window lost focus. Unsanctioned navigation detected.',
        structuredLog: {
          isCheating: true,
          direction: 'UNSANCTIONED_TAB_SWITCH',
          confidence: 1.0,
          event: 'TAB_SWITCH_DETECTED',
          timestamp: now,
          backgroundTrackingActive: true,
          details: source,
        },
      };

      setLastViolationEvent(eventPayload);

      // Log timestamped violation in audit trail
      if (logAuditEvent) {
        logAuditEvent(
          'ERR-TAB-SWITCH',
          'CRITICAL',
          'TAB SWITCH DETECTED / UNSANCTIONED NAVIGATION',
          `Proctoring Alert: Candidate navigated away from active exam window via ${source}. Off-screen continuous gaze tracking engaged.`,
          0,
          eventPayload.structuredLog
        );
      }

      if (onTabSwitchViolation) {
        onTabSwitchViolation(eventPayload);
      }
    },
    [logAuditEvent, onTabSwitchViolation, playTabSwitchAlarm, startBackgroundTicker]
  );

  // ── 4. Handle Re-entry (Tab Regains Visibility / Focus) ────────────────────
  const handleReentry = useCallback(() => {
    if (!violationTriggeredInCurrentSwitchRef.current) return;

    // Clear away timer
    if (awayTimerIntervalRef.current) {
      clearInterval(awayTimerIntervalRef.current);
      awayTimerIntervalRef.current = null;
    }

    const now = Date.now();
    let durationSec = 0;
    if (switchStartTimeRef.current) {
      durationSec = Math.round(((now - switchStartTimeRef.current) / 1000) * 10) / 10;
      setLastAwayDurationSec(durationSec);
      setCurrentAwayDurationSec(0);
      switchStartTimeRef.current = null;
    }

    // Stop background worker ticker (main requestAnimationFrame loop will take over)
    stopBackgroundTicker();

    // Reset flag for next potential tab switch
    violationTriggeredInCurrentSwitchRef.current = false;

    // Open full-screen re-entry validation modal (Candidate MUST recalibrate gaze before resuming)
    setReentryModalOpen(true);

    if (logAuditEvent) {
      logAuditEvent(
        'WARN-TAB-REENTRY',
        'MEDIUM',
        'RE-ENTRY DETECTED // RECALIBRATION REQUIRED',
        `Candidate returned to exam window after ${durationSec}s. Full-screen re-entry lock engaged pending neutral gaze baseline recalibration.`,
        durationSec,
        {
          isCheating: true,
          direction: 'REENTRY_PENDING_CALIBRATION',
          confidence: 0.95,
          durationAwaySec: durationSec,
        }
      );
    }

    if (onReentry) {
      onReentry(durationSec);
    }
  }, [logAuditEvent, onReentry, stopBackgroundTicker]);

  // ── 5. Page Visibility & Window Focus Event Listeners ─────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      const hidden = document.hidden;
      setIsTabVisible(!hidden);

      if (hidden) {
        if (isCameraActive) {
          triggerTabSwitchViolation('VISIBILITY_HIDDEN');
        }
      } else {
        handleReentry();
      }
    };

    const handleWindowBlur = () => {
      setIsWindowFocused(false);
      // If the tab is hidden, visibilitychange already fires; only trigger if not already handled
      if (isCameraActive && !document.hidden) {
        triggerTabSwitchViolation('WINDOW_BLUR');
      }
    };

    const handleWindowFocus = () => {
      setIsWindowFocused(true);
      if (!document.hidden && violationTriggeredInCurrentSwitchRef.current) {
        handleReentry();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [isCameraActive, triggerTabSwitchViolation, handleReentry]);

  // ── 6. Re-entry Dismissal & Mandatory Recalibration ───────────────────────
  const dismissReentryAndCalibrate = useCallback(
    (customCalibrate?: () => void) => {
      // Execute calibration
      if (customCalibrate) {
        customCalibrate();
      } else if (onCalibrate) {
        onCalibrate();
      }

      setReentryModalOpen(false);

      if (logAuditEvent) {
        logAuditEvent(
          'SYS-RECALIBRATE-REENTRY',
          'LOW',
          'RE-ENTRY MANDATORY GAZE CALIBRATION COMPLETED',
          'Candidate completed post-switch recalibration. Baseline normalized and exam resumed.',
          0,
          {
            isCheating: false,
            direction: 'CENTER',
            confidence: 1.0,
            event: 'REENTRY_CALIBRATED',
          }
        );
      }
    },
    [logAuditEvent, onCalibrate]
  );

  // ── 7. Reset Metrics ──────────────────────────────────────────────────────
  const resetTabMetrics = useCallback(() => {
    setTabSwitchCount(0);
    setCurrentAwayDurationSec(0);
    setLastAwayDurationSec(0);
    setReentryModalOpen(false);
    setLastViolationEvent(null);
    violationTriggeredInCurrentSwitchRef.current = false;
    if (awayTimerIntervalRef.current) {
      clearInterval(awayTimerIntervalRef.current);
      awayTimerIntervalRef.current = null;
    }
    stopBackgroundTicker();
  }, [stopBackgroundTicker]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopBackgroundTicker();
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (awayTimerIntervalRef.current) {
        clearInterval(awayTimerIntervalRef.current);
        awayTimerIntervalRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try {
          audioCtxRef.current.close();
        } catch (e) {
          // ignore
        }
      }
    };
  }, [stopBackgroundTicker]);

  return {
    isTabVisible,
    isWindowFocused,
    isBackgroundRunning,
    tabSwitchCount,
    currentAwayDurationSec,
    lastAwayDurationSec,
    reentryModalOpen,
    lastViolationEvent,
    playTabSwitchAlarm,
    dismissReentryAndCalibrate,
    startBackgroundTicker,
    stopBackgroundTicker,
    resetTabMetrics,
  };
}
