'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import {
  calculateCalibratedPostureScore,
  captureBaselinePose,
  BaselinePose,
  CalibratedPostureResult,
  PoseLandmark,
} from '../lib/postureScoring';
import {
  calculatePupilGaze,
  GazeEvaluationResult,
  GazeDirectionType,
  LandmarkPoint,
} from '../lib/gazeDetection';
import { useTabFocusAndGaze } from './useTabFocusAndGaze';

// Intercept Emscripten stderr redirection of benign TFLite informational messages
if (typeof window !== 'undefined' && !(window as any).__tflite_console_filtered) {
  (window as any).__tflite_console_filtered = true;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  console.error = (...args: any[]) => {
    const first = typeof args[0] === 'string' ? args[0] : '';
    if (
      first.startsWith('INFO:') ||
      first.includes('TensorFlow Lite') ||
      first.includes('XNNPACK')
    ) {
      if (console.info) {
        console.info(...args);
      }
      return;
    }
    originalConsoleError.apply(console, args);
  };
  console.warn = (...args: any[]) => {
    const first = typeof args[0] === 'string' ? args[0] : '';
    if (
      first.startsWith('INFO:') ||
      first.includes('TensorFlow Lite') ||
      first.includes('XNNPACK')
    ) {
      if (console.info) {
        console.info(...args);
      }
      return;
    }
    originalConsoleWarn.apply(console, args);
  };
}

export type GazeDirection = GazeDirectionType | 'AWAY' | 'LOOKING_LEFT' | 'LOOKING_RIGHT' | 'LOOKING_DOWN';
export type PostureStatus = 'OPTIMAL' | 'COMPROMISED' | 'CRITICAL';
export type SeverityLevel = 'LOW' | 'MEDIUM' | 'CRITICAL';

export interface AuditEvent {
  id: string;
  timestamp: string;
  code: string;
  severity: SeverityLevel;
  title: string;
  details: string;
  durationSec: number;
  structuredJson?: {
    isCheating: boolean;
    direction: GazeDirectionType | string;
    confidence: number;
    metrics?: Record<string, any>;
    [key: string]: any;
  };
}

export interface PostureMetrics {
  postureScore: number;
  headTilt: number;
  spineLean: number;
  forwardCrane: number;
  slouching: boolean;
  shoulderBalance: number;
  status: PostureStatus;
  isCalibrated: boolean;
  deductions: {
    headTilt: number;
    shoulderBalance: number;
    spineLean: number;
    slouch: number;
  };
}

export interface GazeMetrics {
  direction: GazeDirection;
  headYaw: number;
  headPitch: number;
  irisXRatio: number;
  irisYRatio: number;
  horizontalDeviation: number;
  verticalDeviation: number;
  confidence: number;
  thresholdExceeded: boolean;
}

export interface AntiCheatingMetrics {
  cheatingRiskIndex: number;
  suspiciousDuration: number;
  isViolating: boolean;
  totalViolations: number;
  lastViolationJson?: {
    isCheating: boolean;
    direction: GazeDirectionType;
    confidence: number;
  };
}

export interface ErgonomicsMetrics {
  badPostureDuration: number;
  isPostureCollapsed: boolean;
  totalCollapses: number;
  isCalibrated: boolean;
}

export function useMediaPipe() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Status & Engine States
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelLoadingText, setModelLoadingText] = useState('Initializing Vision Engines...');
  const [cameraActive, setCameraActive] = useState(false);
  const [fps, setFps] = useState(0);

  // Visualization toggles
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showFaceMesh, setShowFaceMesh] = useState(true);
  const [showHudOverlays, setShowHudOverlays] = useState(true);

  // Telemetry States
  const [postureMetrics, setPostureMetrics] = useState<PostureMetrics>({
    postureScore: 100,
    headTilt: 0,
    spineLean: 0,
    forwardCrane: 0,
    slouching: false,
    shoulderBalance: 0,
    status: 'OPTIMAL',
    isCalibrated: false,
    deductions: { headTilt: 0, shoulderBalance: 0, spineLean: 0, slouch: 0 },
  });

  const [gazeMetrics, setGazeMetrics] = useState<GazeMetrics>({
    direction: 'CENTER',
    headYaw: 0,
    headPitch: 0,
    irisXRatio: 0.5,
    irisYRatio: 0.5,
    horizontalDeviation: 0,
    verticalDeviation: 0,
    confidence: 1.0,
    thresholdExceeded: false,
  });

  const [antiCheating, setAntiCheating] = useState<AntiCheatingMetrics>({
    cheatingRiskIndex: 0,
    suspiciousDuration: 0,
    isViolating: false,
    totalViolations: 0,
  });

  const [ergonomics, setErgonomics] = useState<ErgonomicsMetrics>({
    badPostureDuration: 0,
    isPostureCollapsed: false,
    totalCollapses: 0,
    isCalibrated: false,
  });

  const [auditLog, setAuditLog] = useState<AuditEvent[]>([]);

  // Internal references
  const poseLandmarkerRef = useRef<any>(null);
  const faceLandmarkerRef = useRef<any>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const fpsFrameCountRef = useRef<number>(0);
  const fpsTimerRef = useRef<number>(0);
  const isProcessingFrameRef = useRef<boolean>(false);

  // Latest detected landmarks for instant baseline capture
  const latestPoseLandmarksRef = useRef<PoseLandmark[] | null>(null);
  const latestFaceLandmarksRef = useRef<LandmarkPoint[] | null>(null);

  // Calibrated Baselines
  const baselinePoseRef = useRef<BaselinePose | null>(null);
  const gazeBaselineRef = useRef<{ centerX: number; centerY: number; isCalibrated: boolean }>({
    centerX: 0.5,
    centerY: 0.5,
    isCalibrated: false,
  });
  const autoCalibratedFramesCountRef = useRef<number>(0);

  // Rolling State Machine Timing Refs
  const badPostureStartRef = useRef<number | null>(null);
  const badPostureContinuousSecRef = useRef<number>(0);
  const postureAlertTriggeredRef = useRef<boolean>(false);

  const gazeAwayStartRef = useRef<number | null>(null);
  const gazeAwayContinuousSecRef = useRef<number>(0);
  const proctorAlertTriggeredRef = useRef<boolean>(false);

  const totalViolationsRef = useRef<number>(0);
  const totalCollapsesRef = useRef<number>(0);
  const cheatingRiskRef = useRef<number>(0);

  // Web Audio chime synthesizer
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playSynthesizedChime = useCallback((type: 'WARNING' | 'COLLAPSE' | 'CALIBRATE') => {
    try {
      if (typeof window === 'undefined') return;
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          audioCtxRef.current = new AudioCtx();
        }
      }
      const ctx = audioCtxRef.current;
      if (!ctx || ctx.state === 'suspended') {
        ctx?.resume();
      }
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'WARNING') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.15);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.16);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(1200, now + 0.18);
        osc2.frequency.exponentialRampToValueAtTime(600, now + 0.35);
        gain2.gain.setValueAtTime(0.2, now + 0.18);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
        osc2.start(now + 0.18);
        osc2.stop(now + 0.36);
      } else if (type === 'COLLAPSE') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.setValueAtTime(220, now + 0.2);
        osc.frequency.setValueAtTime(180, now + 0.4);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.25);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch (e) {
      // audio suspended or blocked by user gesture
    }
  }, []);

  // Add event to audit log helper with optional structured JSON
  const logAuditEvent = useCallback(
    (
      code: string,
      severity: SeverityLevel,
      title: string,
      details: string,
      durationSec: number,
      structuredJson?: {
        isCheating: boolean;
        direction: GazeDirectionType | string;
        confidence: number;
        metrics?: Record<string, any>;
        [key: string]: any;
      }
    ) => {
      const now = new Date();
      const timeStr =
        now.toTimeString().split(' ')[0] +
        '.' +
        String(now.getMilliseconds()).padStart(3, '0').slice(0, 2);

      const newEvent: AuditEvent = {
        id: `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: timeStr,
        code,
        severity,
        title,
        details,
        durationSec: Math.round(durationSec * 10) / 10,
        structuredJson,
      };

      setAuditLog((prev) => [newEvent, ...prev.slice(0, 99)]);
    },
    []
  );

  // Initialize MediaPipe Vision Engines
  const initMediaPipe = useCallback(async () => {
    if (poseLandmarkerRef.current && faceLandmarkerRef.current) return;
    setIsModelLoading(true);
    setModelLoadingText('Loading WASM Vision Runtime...');

    try {
      const { FilesetResolver, PoseLandmarker, FaceLandmarker } = await import('@mediapipe/tasks-vision');

      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );

      // Load Pose Landmarker (33 Points)
      setModelLoadingText('Booting 33-Point BlazePose Model...');
      let poseLandmarker: any = null;
      try {
        poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch (gpuErr) {
        poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      }
      poseLandmarkerRef.current = poseLandmarker;

      // Load Face Landmarker (468 points + 10 Iris landmarks, refineLandmarks enabled)
      setModelLoadingText('Booting 468+10 Iris FaceMesh Engine...');
      let faceLandmarker: any = null;
      try {
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputFaceBlendshapes: true,
        });
      } catch (gpuErr) {
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
        });
      }
      faceLandmarkerRef.current = faceLandmarker;

      setModelLoadingText('Vision Engines Ready');
    } catch (err) {
      console.error('Failed to initialize MediaPipe:', err);
      setModelLoadingText('Engine load error. Check internet connection.');
    } finally {
      setIsModelLoading(false);
    }
  }, []);

  // Frame Processing Loop
  const processFrame = useCallback(() => {
    if (isProcessingFrameRef.current) return;
    isProcessingFrameRef.current = true;

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        if (typeof document !== 'undefined' && !document.hidden) {
          animFrameIdRef.current = requestAnimationFrame(processFrame);
        }
        return;
      }

      const now = performance.now();
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        if (typeof document !== 'undefined' && !document.hidden) {
          animFrameIdRef.current = requestAnimationFrame(processFrame);
        }
        return;
      }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
    }

    const width = canvas.width;
    const height = canvas.height;

    // Calculate FPS
    fpsFrameCountRef.current++;
    if (now - fpsTimerRef.current >= 1000) {
      setFps(Math.round((fpsFrameCountRef.current * 1000) / (now - fpsTimerRef.current)));
      fpsFrameCountRef.current = 0;
      fpsTimerRef.current = now;
    }

    ctx.clearRect(0, 0, width, height);

    // 1. Run Pose Landmarker
    let poseResult: any = null;
    if (poseLandmarkerRef.current) {
      try {
        poseResult = poseLandmarkerRef.current.detectForVideo(video, now);
      } catch (e) {
        // frame skipped
      }
    }

    // 2. Run Face Landmarker
    let faceResult: any = null;
    if (faceLandmarkerRef.current) {
      try {
        faceResult = faceLandmarkerRef.current.detectForVideo(video, now);
      } catch (e) {
        // frame skipped
      }
    }

    const poseLandmarks: PoseLandmark[] | undefined = poseResult?.landmarks?.[0];
    const faceLandmarks: LandmarkPoint[] | undefined = faceResult?.faceLandmarks?.[0];

    if (poseLandmarks) {
      latestPoseLandmarksRef.current = poseLandmarks;
    }
    if (faceLandmarks) {
      latestFaceLandmarksRef.current = faceLandmarks;
    }

    // Auto-calibrate initial upright posture on startup if user hasn't explicitly clicked yet
    if (poseLandmarks && poseLandmarks.length >= 13 && !baselinePoseRef.current) {
      autoCalibratedFramesCountRef.current++;
      if (autoCalibratedFramesCountRef.current >= 15) {
        baselinePoseRef.current = captureBaselinePose(poseLandmarks);
        if (faceLandmarks && faceLandmarks.length >= 468) {
          const evalGaze = calculatePupilGaze(faceLandmarks);
          gazeBaselineRef.current = {
            centerX: evalGaze.horizontalRatio,
            centerY: evalGaze.verticalRatio,
            isCalibrated: true,
          };
        }
        setErgonomics((prev) => ({ ...prev, isCalibrated: true }));
      }
    }

    // ── A. Dynamic Calibrated Posture Scoring ──────────────────────────────────
    let postureScore = 100;
    let headTilt = 0;
    let spineLean = 0;
    let forwardCrane = 0;
    let shoulderBalance = 0;
    let isSlouching = false;
    let postureStatus: PostureStatus = 'OPTIMAL';
    let deductions = { headTilt: 0, shoulderBalance: 0, spineLean: 0, slouch: 0 };

    if (poseLandmarks && poseLandmarks.length >= 13) {
      const postureResult: CalibratedPostureResult = calculateCalibratedPostureScore(
        poseLandmarks,
        baselinePoseRef.current
      );

      postureScore = postureResult.score;
      headTilt = postureResult.headTiltDeg;
      shoulderBalance = postureResult.shoulderBalanceDeg;
      spineLean = postureResult.spineLeanDeg;
      forwardCrane = Math.round(postureResult.slouchRatio * 100);
      isSlouching = postureResult.isSlouching;
      postureStatus = postureResult.status;
      deductions = postureResult.deductions;
    }

    // ── B. High-Sensitivity Eye-Gaze & Pupil Deviation Engine ───────────────────
    const gazeResult: GazeEvaluationResult = calculatePupilGaze(
      faceLandmarks,
      gazeBaselineRef.current
    );

    const gazeDir: GazeDirection = gazeResult.direction;
    const headYaw = gazeResult.headYawDeg;
    const headPitch = gazeResult.headPitchDeg;
    const irisXRatio = gazeResult.horizontalRatio;
    const irisYRatio = gazeResult.verticalRatio;
    const horizontalDeviation = gazeResult.horizontalDeviation;
    const verticalDeviation = gazeResult.verticalDeviation;
    const gazeConfidence = gazeResult.confidence;
    const thresholdExceeded = gazeResult.thresholdExceeded;

    // ── C. State Machine: 30-Second Ergonomic Bad Posture Rule ────────────────
    const isBadPosture = postureScore < 60;
    let badSec = 0;
    let isCollapsed = false;

    if (isBadPosture) {
      if (!badPostureStartRef.current) {
        badPostureStartRef.current = now;
      }
      badSec = (now - badPostureStartRef.current) / 1000;
      badPostureContinuousSecRef.current = badSec;

      if (badSec >= 30.0 && !postureAlertTriggeredRef.current) {
        postureAlertTriggeredRef.current = true;
        isCollapsed = true;
        totalCollapsesRef.current += 1;
        playSynthesizedChime('COLLAPSE');
        logAuditEvent(
          'ERR-POSTURE-COLLAPSE',
          'CRITICAL',
          'CRITICAL POSTURE COLLAPSE',
          `Sustained poor posture (${postureScore}%) for 30s. Spine lean: ${spineLean}°, Head tilt: ${headTilt}°.`,
          badSec
        );
      }
    } else {
      badPostureStartRef.current = null;
      badPostureContinuousSecRef.current = 0;
      postureAlertTriggeredRef.current = false;
    }

    // ── D. State Machine: 3-Second Anti-Cheating Gaze Deflection Rule ─────────
    const isGazeAway = gazeDir !== 'CENTER' || thresholdExceeded;
    let gazeSec = 0;
    let isViolating = false;

    if (isGazeAway) {
      if (!gazeAwayStartRef.current) {
        gazeAwayStartRef.current = now;
      }
      gazeSec = (now - gazeAwayStartRef.current) / 1000;
      gazeAwayContinuousSecRef.current = gazeSec;

      // Rate depends on high-risk direction (e.g. looking down at phone vs sideways)
      const riskIncrement = gazeDir === 'DOWN' ? 1.6 : 1.1;
      cheatingRiskRef.current = Math.min(100, cheatingRiskRef.current + riskIncrement);

      if (gazeSec >= 3.0 && !proctorAlertTriggeredRef.current) {
        proctorAlertTriggeredRef.current = true;
        isViolating = true;
        totalViolationsRef.current += 1;
        playSynthesizedChime('WARNING');

        // Structured JSON log output requested in specs
        const structuredLog = {
          isCheating: true,
          direction: gazeResult.direction,
          confidence: gazeConfidence,
          metrics: {
            horizontalDeviation,
            verticalDeviation,
            headYaw,
            headPitch,
            durationSec: Math.round(gazeSec * 10) / 10,
          },
        };

        const violationCode =
          gazeDir === 'DOWN'
            ? 'SUSPICIOUS_GAZE_ALERT_DOWN'
            : gazeDir === 'LEFT' || gazeDir === 'RIGHT'
            ? 'SUSPICIOUS_GAZE_ALERT_LATERAL'
            : 'SUSPICIOUS_GAZE_ALERT';

        logAuditEvent(
          violationCode,
          'CRITICAL',
          'SUSPICIOUS_GAZE_ALERT: CHEATING RISK FLAGGED',
          `Continuous pupil deviation (>15% threshold) for ${Math.round(gazeSec * 10) / 10}s in direction ${gazeDir}.`,
          gazeSec,
          structuredLog
        );
      }
    } else {
      gazeAwayStartRef.current = null;
      gazeAwayContinuousSecRef.current = 0;
      proctorAlertTriggeredRef.current = false;
      cheatingRiskRef.current = Math.max(0, cheatingRiskRef.current - 0.4);
    }

    // Update React states for Dashboard
    setPostureMetrics({
      postureScore,
      headTilt,
      spineLean,
      forwardCrane,
      slouching: isSlouching,
      shoulderBalance,
      status: postureStatus,
      isCalibrated: Boolean(baselinePoseRef.current?.isCalibrated),
      deductions,
    });

    setGazeMetrics({
      direction: gazeDir,
      headYaw,
      headPitch,
      irisXRatio,
      irisYRatio,
      horizontalDeviation,
      verticalDeviation,
      confidence: gazeConfidence,
      thresholdExceeded,
    });

    setAntiCheating({
      cheatingRiskIndex: Math.round(cheatingRiskRef.current),
      suspiciousDuration: Math.round(gazeAwayContinuousSecRef.current * 10) / 10,
      isViolating: isViolating || proctorAlertTriggeredRef.current,
      totalViolations: totalViolationsRef.current,
      lastViolationJson: {
        isCheating: isGazeAway,
        direction: gazeResult.direction,
        confidence: gazeConfidence,
      },
    });

    setErgonomics({
      badPostureDuration: Math.round(badPostureContinuousSecRef.current * 10) / 10,
      isPostureCollapsed: isCollapsed || postureAlertTriggeredRef.current,
      totalCollapses: totalCollapsesRef.current,
      isCalibrated: Boolean(baselinePoseRef.current?.isCalibrated),
    });

    // ── E. Cyberpunk HUD Rendering On Canvas ─────────────────────────────────
    ctx.save();

    // 1. Draw 33 Body Keypoints Skeleton
    if (showSkeleton && poseLandmarks) {
      const connections = [
        [11, 12], // shoulders
        [11, 23], // left torso
        [12, 24], // right torso
        [23, 24], // hips
        [11, 13], [13, 15], // left arm
        [12, 14], [14, 16], // right arm
        [7, 0], [8, 0], // ears to nose
      ];

      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 8;

      connections.forEach(([i, j]) => {
        const p1 = poseLandmarks[i];
        const p2 = poseLandmarks[j];
        if (p1 && p2 && (p1.visibility ?? 1) > 0.4 && (p2.visibility ?? 1) > 0.4) {
          ctx.strokeStyle =
            postureScore < 60 ? '#FF2244' : spineLean > 8 ? '#FFB800' : '#00FF66';
          ctx.shadowColor = ctx.strokeStyle;
          ctx.beginPath();
          ctx.moveTo(p1.x * width, p1.y * height);
          ctx.lineTo(p2.x * width, p2.y * height);
          ctx.stroke();
        }
      });

      poseLandmarks.forEach((pt: any, idx: number) => {
        if (idx > 24) return;
        if ((pt.visibility ?? 1) > 0.4) {
          const px = pt.x * width;
          const py = pt.y * height;
          ctx.fillStyle = idx === 0 ? '#00F0FF' : postureScore < 60 ? '#FF2244' : '#00FF66';
          ctx.shadowColor = ctx.fillStyle;
          ctx.beginPath();
          ctx.arc(px, py, idx === 0 ? 5 : 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    // 2. Draw 468 Face Mesh & 10 Iris Points
    if (showFaceMesh && faceLandmarks) {
      ctx.shadowBlur = 0;
      ctx.fillStyle =
        gazeDir === 'CENTER' ? 'rgba(0, 255, 102, 0.4)' : 'rgba(255, 184, 0, 0.6)';

      const keyMeshIndices = [
        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
        400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
        54, 103, 67, 109,
        // Lips
        61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
        // Eye contours
        33, 160, 158, 133, 153, 144, 263, 387, 385, 362, 380, 373,
      ];

      keyMeshIndices.forEach((idx) => {
        const pt = faceLandmarks[idx];
        if (pt) {
          ctx.fillRect(pt.x * width - 1, pt.y * height - 1, 2, 2);
        }
      });

      // Iris Crosshairs (Points 468 & 473)
      const irisL = faceLandmarks[468];
      const irisR = faceLandmarks[473];
      [irisL, irisR].forEach((iris) => {
        if (iris) {
          const ix = iris.x * width;
          const iy = iris.y * height;
          ctx.strokeStyle = thresholdExceeded ? '#FF2244' : '#00FF66';
          ctx.shadowColor = ctx.strokeStyle;
          ctx.shadowBlur = 6;
          ctx.lineWidth = 1.5;

          ctx.beginPath();
          ctx.arc(ix, iy, 7, 0, Math.PI * 2);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(ix - 10, iy);
          ctx.lineTo(ix + 10, iy);
          ctx.moveTo(ix, iy - 10);
          ctx.lineTo(ix, iy + 10);
          ctx.stroke();
        }
      });
    }

    // 3. Draw Cyberpunk HUD Reticles & Gaze Ray
    if (showHudOverlays && faceLandmarks) {
      const chin = faceLandmarks[152];
      const forehead = faceLandmarks[10];
      const cheekL = faceLandmarks[234];
      const cheekR = faceLandmarks[454];

      if (chin && forehead && cheekL && cheekR) {
        const boxX = Math.min(cheekL.x, cheekR.x) * width - 20;
        const boxY = forehead.y * height - 35;
        const boxW = Math.abs(cheekR.x - cheekL.x) * width + 40;
        const boxH = Math.abs(chin.y - forehead.y) * height + 50;

        const hudColor =
          gazeDir === 'CENTER'
            ? '#00FF66'
            : gazeDir === 'DOWN'
            ? '#FF2244'
            : '#FFB800';

        ctx.strokeStyle = hudColor;
        ctx.lineWidth = 2;
        ctx.shadowColor = hudColor;
        ctx.shadowBlur = 10;

        const bracketLen = 18;
        // Top-left
        ctx.beginPath();
        ctx.moveTo(boxX, boxY + bracketLen);
        ctx.lineTo(boxX, boxY);
        ctx.lineTo(boxX + bracketLen, boxY);
        ctx.stroke();

        // Top-right
        ctx.beginPath();
        ctx.moveTo(boxX + boxW - bracketLen, boxY);
        ctx.lineTo(boxX + boxW, boxY);
        ctx.lineTo(boxX + boxW, boxY + bracketLen);
        ctx.stroke();

        // Bottom-left
        ctx.beginPath();
        ctx.moveTo(boxX, boxY + boxH - bracketLen);
        ctx.lineTo(boxX, boxY + boxH);
        ctx.lineTo(boxX + bracketLen, boxY + boxH);
        ctx.stroke();

        // Bottom-right
        ctx.beginPath();
        ctx.moveTo(boxX + boxW - bracketLen, boxY + boxH);
        ctx.lineTo(boxX + boxW, boxY + boxH);
        ctx.lineTo(boxX + boxW, boxY + boxH - bracketLen);
        ctx.stroke();

        // Target Tag Text
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = hudColor;
        ctx.shadowBlur = 4;
        ctx.fillText(
          `TARGET: CANDIDATE_01 [GAZE: ${gazeDir}] [SCORE: ${postureScore}%]`,
          boxX,
          boxY - 8
        );

        // Gaze Vector Pointer
        const nose = faceLandmarks[1];
        if (nose) {
          const nx = nose.x * width;
          const ny = nose.y * height;
          const rayLen = 45;
          const rayDx = (headYaw / 45) * rayLen + horizontalDeviation * 40;
          const rayDy = (headPitch / 45) * rayLen + verticalDeviation * 40;

          ctx.beginPath();
          ctx.strokeStyle = hudColor;
          ctx.lineWidth = 2;
          ctx.moveTo(nx, ny);
          ctx.lineTo(nx + rayDx, ny + rayDy);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(nx + rayDx, ny + rayDy, 3, 0, Math.PI * 2);
          ctx.fillStyle = hudColor;
          ctx.fill();
        }
      }
    }

      ctx.restore();
      if (typeof document !== 'undefined' && document.hidden) {
        // Tab is hidden; frame loop is driven by off-screen Web Worker ticks
        return;
      }
      animFrameIdRef.current = requestAnimationFrame(processFrame);
    } finally {
      isProcessingFrameRef.current = false;
    }
  }, [showSkeleton, showFaceMesh, showHudOverlays, logAuditEvent, playSynthesizedChime]);

  // Start Webcam
  const startCamera = useCallback(async () => {
    try {
      await initMediaPipe();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        animFrameIdRef.current = requestAnimationFrame(processFrame);
      }
    } catch (err: any) {
      console.error('Failed to start webcam:', err);
      logAuditEvent(
        'CAM-ERR',
        'CRITICAL',
        'WEBCAM ACCESS FAILED',
        err.message || 'Camera permission denied',
        0
      );
    }
  }, [initMediaPipe, processFrame, logAuditEvent]);

  // Stop Webcam
  const stopCamera = useCallback(() => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  // Baseline Calibration: Capture user's good sitting posture & pupil center
  const calibrate = useCallback(() => {
    const currentPose = latestPoseLandmarksRef.current;
    const currentFace = latestFaceLandmarksRef.current;

    if (currentPose && currentPose.length >= 13) {
      baselinePoseRef.current = captureBaselinePose(currentPose);
    } else {
      // Fallback default upright baseline
      baselinePoseRef.current = {
        earAngle: 0,
        shoulderAngle: 0,
        spineAngle: 0,
        earShoulderDist: 0.18,
        noseToShoulderDist: 0.22,
        isCalibrated: true,
        timestamp: Date.now(),
      };
    }

    if (currentFace && currentFace.length >= 468) {
      const evalGaze = calculatePupilGaze(currentFace);
      gazeBaselineRef.current = {
        centerX: evalGaze.horizontalRatio,
        centerY: evalGaze.verticalRatio,
        isCalibrated: true,
      };
    } else {
      gazeBaselineRef.current = {
        centerX: 0.5,
        centerY: 0.5,
        isCalibrated: true,
      };
    }

    setErgonomics((prev) => ({ ...prev, isCalibrated: true }));
    playSynthesizedChime('CALIBRATE');
    logAuditEvent(
      'SYS-CALIBRATE',
      'LOW',
      'NEUTRAL BASELINE POSTURE CALIBRATED',
      'Captured initial upright posture baseline with +/-3° deadband tolerance. Posture normalized to 100%.',
      0
    );
  }, [playSynthesizedChime, logAuditEvent]);

  // Dismiss Posture Collapse Alert
  const dismissPostureAlert = useCallback(() => {
    badPostureStartRef.current = null;
    badPostureContinuousSecRef.current = 0;
    postureAlertTriggeredRef.current = false;
    setErgonomics((prev) => ({
      ...prev,
      badPostureDuration: 0,
      isPostureCollapsed: false,
    }));
  }, []);

  // Dismiss Proctor Alert
  const dismissProctorAlert = useCallback(() => {
    gazeAwayStartRef.current = null;
    gazeAwayContinuousSecRef.current = 0;
    proctorAlertTriggeredRef.current = false;
    setAntiCheating((prev) => ({
      ...prev,
      suspiciousDuration: 0,
      isViolating: false,
    }));
  }, []);

  // Clear Audit Log
  const clearAuditLog = useCallback(() => {
    setAuditLog([]);
  }, []);

  // ── Integrate Tab Focus & Continuous Background Gaze Sentry ─────────────
  const tabFocus = useTabFocusAndGaze({
    isCameraActive: cameraActive,
    onBackgroundTick: () => {
      processFrame();
    },
    onCalibrate: () => {
      calibrate();
    },
    logAuditEvent: (code, severity, title, details, durationSec, structuredJson) => {
      logAuditEvent(code, severity, title, details, durationSec || 0, structuredJson);
    },
  });

  // Re-engage requestAnimationFrame when candidate returns to visible & active tab
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const handleVisibilityResume = () => {
      if (!document.hidden && cameraActive) {
        if (animFrameIdRef.current) {
          cancelAnimationFrame(animFrameIdRef.current);
        }
        animFrameIdRef.current = requestAnimationFrame(processFrame);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityResume);
    window.addEventListener('focus', handleVisibilityResume);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityResume);
      window.removeEventListener('focus', handleVisibilityResume);
    };
  }, [cameraActive, processFrame]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return {
    videoRef,
    canvasRef,
    isModelLoading,
    modelLoadingText,
    cameraActive,
    fps,
    postureMetrics,
    gazeMetrics,
    antiCheating,
    ergonomics,
    auditLog,
    showSkeleton,
    showFaceMesh,
    showHudOverlays,
    setShowSkeleton,
    setShowFaceMesh,
    setShowHudOverlays,
    startCamera,
    stopCamera,
    calibrate,
    dismissPostureAlert,
    dismissProctorAlert,
    clearAuditLog,
    logAuditEvent,
    tabFocus,
    processFrame,
  };
}
