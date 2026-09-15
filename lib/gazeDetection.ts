/**
 * High-Sensitivity Eye-Gaze and Pupil Deviation Detection Engine
 * 
 * MediaPipe Face Mesh Landmark mapping (with refineLandmarks / iris enabled):
 * - Left Pupil: 468
 * - Right Pupil: 473
 * - Left Eye: Outer 33, Inner 133, Top 159, Bottom 145
 * - Right Eye: Inner 362, Outer 263, Top 386, Bottom 374
 * - Head Orientation: Nose 1, Chin 152, Forehead 10, CheekL 234, CheekR 454
 */

export type GazeDirectionType = 'LEFT' | 'RIGHT' | 'DOWN' | 'UP' | 'CENTER';

export interface GazeEvaluationResult {
  isCheating: boolean;
  direction: GazeDirectionType;
  confidence: number;
  horizontalRatio: number; // 0.0 - 1.0 (0.5 is centered)
  verticalRatio: number;   // 0.0 - 1.0 (0.5 is centered)
  horizontalDeviation: number; // Signed deviation from center (-0.5 to +0.5)
  verticalDeviation: number;   // Signed deviation from center (-0.5 to +0.5)
  thresholdExceeded: boolean;
  reason?: string;
  headYawDeg: number;
  headPitchDeg: number;
}

export interface GazeBaseline {
  centerX: number;
  centerY: number;
  isCalibrated: boolean;
}

export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

/**
 * Strict threshold: 15% deviation from screen center triggers look-away alert
 */
export const GAZE_DEVIATION_THRESHOLD = 0.15; // 15%

/**
 * Evaluates pupil deviation and head angle frame-by-frame with high sensitivity
 */
export function calculatePupilGaze(
  faceLandmarks: LandmarkPoint[] | undefined | null,
  baseline: GazeBaseline = { centerX: 0.5, centerY: 0.5, isCalibrated: false }
): GazeEvaluationResult {
  // If no face in frame -> looking away / cheating alert
  if (!faceLandmarks || faceLandmarks.length < 468) {
    return {
      isCheating: true,
      direction: 'CENTER', // face missing
      confidence: 0.0,
      horizontalRatio: 0.5,
      verticalRatio: 0.5,
      horizontalDeviation: 0.5,
      verticalDeviation: 0.5,
      thresholdExceeded: true,
      reason: 'NO_FACE_DETECTED',
      headYawDeg: 0,
      headPitchDeg: 0,
    };
  }

  // Eye Corner and Eyelid points
  const eyeLOuter = faceLandmarks[33];
  const eyeLInner = faceLandmarks[133];
  const eyeLTop = faceLandmarks[159];
  const eyeLBottom = faceLandmarks[145];

  const eyeROuter = faceLandmarks[263];
  const eyeRInner = faceLandmarks[362];
  const eyeRTop = faceLandmarks[386];
  const eyeRBottom = faceLandmarks[374];

  // Pupil / Iris Centers (Points 468 and 473)
  const pupilL = faceLandmarks[468] || {
    x: (eyeLOuter.x + eyeLInner.x) / 2,
    y: (eyeLTop.y + eyeLBottom.y) / 2,
  };
  const pupilR = faceLandmarks[473] || {
    x: (eyeROuter.x + eyeRInner.x) / 2,
    y: (eyeRTop.y + eyeRBottom.y) / 2,
  };

  // 1. Horizontal Gaze Ratio (Left eye: outer 33 to inner 133)
  const eyeLWidth = Math.max(0.001, Math.abs(eyeLInner.x - eyeLOuter.x));
  const minX = Math.min(eyeLOuter.x, eyeLInner.x);
  const ratioXLeft = (pupilL.x - minX) / eyeLWidth;

  // Right eye horizontal ratio
  const eyeRWidth = Math.max(0.001, Math.abs(eyeROuter.x - eyeRInner.x));
  const minXR = Math.min(eyeROuter.x, eyeRInner.x);
  const ratioXRight = (pupilR.x - minXR) / eyeRWidth;

  // Average horizontal gaze ratio
  const rawHorizontalRatio = (ratioXLeft + ratioXRight) / 2;

  // 2. Vertical Gaze Ratio (top 159 to bottom 145)
  const eyeLHeight = Math.max(0.001, Math.abs(eyeLBottom.y - eyeLTop.y));
  const ratioYLeft = (pupilL.y - eyeLTop.y) / eyeLHeight;

  const eyeRHeight = Math.max(0.001, Math.abs(eyeRBottom.y - eyeRTop.y));
  const ratioYRight = (pupilR.y - eyeRTop.y) / eyeRHeight;

  // Average vertical gaze ratio
  const rawVerticalRatio = (ratioYLeft + ratioYRight) / 2;

  // Head orientation for compound verification
  const noseTip = faceLandmarks[1];
  const chin = faceLandmarks[152];
  const forehead = faceLandmarks[10];
  const cheekL = faceLandmarks[234];
  const cheekR = faceLandmarks[454];

  const cheekSpan = Math.max(0.001, Math.abs(cheekR.x - cheekL.x));
  const headYawDeg = Math.round(((noseTip.x - cheekL.x) / cheekSpan - 0.5) * 90);

  const faceSpan = Math.max(0.001, Math.abs(chin.y - forehead.y));
  const headPitchDeg = Math.round(((noseTip.y - forehead.y) / faceSpan - 0.6) * 110);

  // Offset relative to calibrated center (default 0.5)
  const centerTargetX = baseline.isCalibrated ? baseline.centerX : 0.5;
  const centerTargetY = baseline.isCalibrated ? baseline.centerY : 0.5;

  const horizontalDeviation = rawHorizontalRatio - centerTargetX;
  const verticalDeviation = rawVerticalRatio - centerTargetY;

  // 3. Evaluate 15% Strict Threshold & Direction
  let direction: GazeDirectionType = 'CENTER';
  let thresholdExceeded = false;
  let reason = '';

  // Downward gaze has highest priority (reading notes / hidden phone)
  if (verticalDeviation > GAZE_DEVIATION_THRESHOLD || headPitchDeg > 16) {
    direction = 'DOWN';
    thresholdExceeded = true;
    reason = 'LOOKING_DOWN_AT_NOTES_OR_PHONE';
  } else if (verticalDeviation < -GAZE_DEVIATION_THRESHOLD || headPitchDeg < -18) {
    direction = 'UP';
    thresholdExceeded = true;
    reason = 'LOOKING_UP_OFF_SCREEN';
  } else if (horizontalDeviation < -GAZE_DEVIATION_THRESHOLD || headYawDeg < -15) {
    direction = 'LEFT';
    thresholdExceeded = true;
    reason = 'HORIZONTAL_GAZE_DEFLECTION_LEFT';
  } else if (horizontalDeviation > GAZE_DEVIATION_THRESHOLD || headYawDeg > 15) {
    direction = 'RIGHT';
    thresholdExceeded = true;
    reason = 'HORIZONTAL_GAZE_DEFLECTION_RIGHT';
  } else {
    direction = 'CENTER';
    thresholdExceeded = false;
  }

  return {
    isCheating: thresholdExceeded,
    direction,
    confidence: 0.96,
    horizontalRatio: Math.round(rawHorizontalRatio * 100) / 100,
    verticalRatio: Math.round(rawVerticalRatio * 100) / 100,
    horizontalDeviation: Math.round(horizontalDeviation * 100) / 100,
    verticalDeviation: Math.round(verticalDeviation * 100) / 100,
    thresholdExceeded,
    reason,
    headYawDeg,
    headPitchDeg,
  };
}
