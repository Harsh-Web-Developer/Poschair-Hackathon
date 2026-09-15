/**
 * Calibrated Posture Scoring Engine
 * 
 * Provides calibrated baseline capture, +/- 3 degree tolerance deadbands,
 * and soft linear penalty multipliers so straight sitting posture scores 95%-100%.
 */

export interface PoseLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface BaselinePose {
  earAngle: number;         // Head tilt angle in degrees
  shoulderAngle: number;    // Shoulder level angle in degrees
  spineAngle: number;       // Spine lean angle in degrees
  earShoulderDist: number;  // Vertical distance between ears and shoulders
  noseToShoulderDist: number; // Euclidean distance from nose to shoulder center
  isCalibrated: boolean;
  timestamp: number;
}

export interface CalibratedPostureResult {
  score: number;            // 0 - 100%
  headTiltDeg: number;      // Deviation from baseline in degrees
  shoulderBalanceDeg: number; // Deviation from baseline in degrees
  spineLeanDeg: number;     // Deviation from baseline in degrees
  slouchRatio: number;      // Forward crane compression ratio (0 - 1)
  isSlouching: boolean;
  status: 'OPTIMAL' | 'COMPROMISED' | 'CRITICAL';
  deductions: {
    headTilt: number;
    shoulderBalance: number;
    spineLean: number;
    slouch: number;
  };
}

/**
 * Capture baseline good posture from current MediaPipe Pose landmarks (33 points)
 * Keypoints used:
 * 0: Nose, 7: Left Ear, 8: Right Ear, 11: Left Shoulder, 12: Right Shoulder, 23: Left Hip, 24: Right Hip
 */
export function captureBaselinePose(landmarks: PoseLandmark[]): BaselinePose {
  if (!landmarks || landmarks.length < 13) {
    return {
      earAngle: 0,
      shoulderAngle: 0,
      spineAngle: 0,
      earShoulderDist: 0.18,
      noseToShoulderDist: 0.22,
      isCalibrated: false,
      timestamp: Date.now(),
    };
  }

  const nose = landmarks[0];
  const earL = landmarks[7];
  const earR = landmarks[8];
  const shL = landmarks[11];
  const shR = landmarks[12];
  const hipL = landmarks[23];
  const hipR = landmarks[24];

  // Head tilt baseline angle
  const earDx = earL.x - earR.x;
  const earDy = earL.y - earR.y;
  const earAngle = (Math.atan2(earDy, earDx) * 180) / Math.PI;

  // Shoulder level baseline angle
  const shDx = shL.x - shR.x;
  const shDy = shL.y - shR.y;
  const shoulderAngle = (Math.atan2(shDy, shDx) * 180) / Math.PI;

  // Spine lateral lean baseline angle
  const shMidX = (shL.x + shR.x) / 2;
  const shMidY = (shL.y + shR.y) / 2;
  let spineAngle = 0;
  if (hipL && hipR) {
    const hipMidX = (hipL.x + hipR.x) / 2;
    const hipMidY = (hipL.y + hipR.y) / 2;
    const spineDx = shMidX - hipMidX;
    const spineDy = hipMidY - shMidY;
    spineAngle = (Math.atan2(spineDx, spineDy) * 180) / Math.PI;
  }

  // Ear-to-shoulder vertical baseline distance
  const earMidY = (earL.y + earR.y) / 2;
  const earShoulderDist = Math.max(0.05, Math.abs(shMidY - earMidY));

  // Nose-to-shoulder euclidean distance
  const noseToShoulderDist = Math.sqrt(
    Math.pow(nose.x - shMidX, 2) + Math.pow(nose.y - shMidY, 2)
  );

  return {
    earAngle,
    shoulderAngle,
    spineAngle,
    earShoulderDist,
    noseToShoulderDist: Math.max(0.1, noseToShoulderDist),
    isCalibrated: true,
    timestamp: Date.now(),
  };
}

/**
 * Calculates dynamically calibrated posture score.
 * 
 * Rules:
 * - Base Score: 100
 * - Tolerance zone: +/- 3 degrees for head tilt, shoulder alignment, and spine lean (NO penalty)
 * - Soft linear penalty multiplier: minor natural shifts do not drop score below 90%
 * - Straight posture comfortably yields 95% - 100%
 */
export function calculateCalibratedPostureScore(
  currentPose: PoseLandmark[],
  baselinePose: BaselinePose | null
): CalibratedPostureResult {
  if (!currentPose || currentPose.length < 13) {
    return {
      score: 100,
      headTiltDeg: 0,
      shoulderBalanceDeg: 0,
      spineLeanDeg: 0,
      slouchRatio: 0,
      isSlouching: false,
      status: 'OPTIMAL',
      deductions: { headTilt: 0, shoulderBalance: 0, spineLean: 0, slouch: 0 },
    };
  }

  const earL = currentPose[7];
  const earR = currentPose[8];
  const shL = currentPose[11];
  const shR = currentPose[12];
  const hipL = currentPose[23];
  const hipR = currentPose[24];

  // 1. Current Head Tilt
  const earDx = earL.x - earR.x;
  const earDy = earL.y - earR.y;
  const currentEarAngle = (Math.atan2(earDy, earDx) * 180) / Math.PI;
  const baseEarAngle = baselinePose?.isCalibrated ? baselinePose.earAngle : 0;
  const rawHeadTiltDiff = Math.abs(currentEarAngle - baseEarAngle);

  // 2. Current Shoulder Balance
  const shDx = shL.x - shR.x;
  const shDy = shL.y - shR.y;
  const currentShAngle = (Math.atan2(shDy, shDx) * 180) / Math.PI;
  const baseShAngle = baselinePose?.isCalibrated ? baselinePose.shoulderAngle : 0;
  const rawShoulderDiff = Math.abs(currentShAngle - baseShAngle);

  // 3. Current Spine Lean
  const shMidX = (shL.x + shR.x) / 2;
  const shMidY = (shL.y + shR.y) / 2;
  let currentSpineAngle = 0;
  if (hipL && hipR) {
    const hipMidX = (hipL.x + hipR.x) / 2;
    const hipMidY = (hipL.y + hipR.y) / 2;
    const spineDx = shMidX - hipMidX;
    const spineDy = hipMidY - shMidY;
    currentSpineAngle = (Math.atan2(spineDx, spineDy) * 180) / Math.PI;
  }
  const baseSpineAngle = baselinePose?.isCalibrated ? baselinePose.spineAngle : 0;
  const rawSpineDiff = Math.abs(currentSpineAngle - baseSpineAngle);

  // 4. Slouching / Forward Crane Compression
  const earMidY = (earL.y + earR.y) / 2;
  const currentEarShoulderDist = Math.abs(shMidY - earMidY);
  const baseEarShoulderDist = baselinePose?.isCalibrated
    ? baselinePose.earShoulderDist
    : 0.18;

  // Compression ratio relative to calibrated baseline
  const heightDelta = baseEarShoulderDist - currentEarShoulderDist;
  const slouchRatio = Math.max(0, heightDelta / baseEarShoulderDist);

  // ── Tolerance Zone (+/- 3 Degrees Deadband) ──────────────────────────────
  const TOLERANCE_DEG = 3.0; // No penalty within +/- 3° of calibrated posture

  const excessHeadTilt = Math.max(0, rawHeadTiltDiff - TOLERANCE_DEG);
  const excessShoulder = Math.max(0, rawShoulderDiff - TOLERANCE_DEG);
  const excessSpine = Math.max(0, rawSpineDiff - TOLERANCE_DEG);

  // ── Soft Linear Penalty Multipliers ───────────────────────────────────────
  // Soft slope for minor movements (first 5 degrees above tolerance)
  // Ensures normal breathing and micro-movements stay >90%
  const calcSoftPenalty = (excess: number, softRate: number, hardRate: number): number => {
    if (excess <= 0) return 0;
    if (excess <= 5.0) {
      return excess * softRate; // e.g. 5° * 0.8 = 4 points off -> score is 96%
    }
    return 5.0 * softRate + (excess - 5.0) * hardRate;
  };

  const headTiltDeduction = calcSoftPenalty(excessHeadTilt, 0.8, 2.0);
  const shoulderDeduction = calcSoftPenalty(excessShoulder, 0.7, 1.8);
  const spineDeduction = calcSoftPenalty(excessSpine, 1.0, 3.2);

  // Slouch penalty: tolerance up to 12% vertical compression before deducting
  let slouchDeduction = 0;
  const isSlouching = slouchRatio > 0.18;
  if (slouchRatio > 0.12) {
    const excessSlouch = slouchRatio - 0.12;
    slouchDeduction = Math.min(30, excessSlouch * 70);
  }

  const totalDeductions = headTiltDeduction + shoulderDeduction + spineDeduction + slouchDeduction;
  const finalScore = Math.max(0, Math.min(100, Math.round(100 - totalDeductions)));

  let status: 'OPTIMAL' | 'COMPROMISED' | 'CRITICAL' = 'OPTIMAL';
  if (finalScore >= 85) {
    status = 'OPTIMAL';
  } else if (finalScore >= 60) {
    status = 'COMPROMISED';
  } else {
    status = 'CRITICAL';
  }

  return {
    score: finalScore,
    headTiltDeg: Math.round(rawHeadTiltDiff * 10) / 10,
    shoulderBalanceDeg: Math.round(rawShoulderDiff * 10) / 10,
    spineLeanDeg: Math.round(rawSpineDiff * 10) / 10,
    slouchRatio: Math.round(slouchRatio * 100) / 100,
    isSlouching,
    status,
    deductions: {
      headTilt: Math.round(headTiltDeduction * 10) / 10,
      shoulderBalance: Math.round(shoulderDeduction * 10) / 10,
      spineLean: Math.round(spineDeduction * 10) / 10,
      slouch: Math.round(slouchDeduction * 10) / 10,
    },
  };
}
