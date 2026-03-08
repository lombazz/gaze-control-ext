import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { CalibrationCoefficients } from "../shared/types.js";
import {
  LEFT_IRIS_CENTER,
  RIGHT_IRIS_CENTER,
  LEFT_EYE_INNER,
  LEFT_EYE_OUTER,
  RIGHT_EYE_INNER,
  RIGHT_EYE_OUTER,
  LEFT_EYE_TOP,
  LEFT_EYE_BOTTOM,
  RIGHT_EYE_TOP,
  RIGHT_EYE_BOTTOM,
} from "../shared/constants.js";

export class GazeEstimator {
  private calibration: CalibrationCoefficients | null = null;
  private smoothedX = 0.5;
  private smoothedY = 0.5;
  private alpha = 0.3;
  private viewportWidth = 1920;
  private viewportHeight = 1080;

  setCalibration(coefficients: CalibrationCoefficients) {
    this.calibration = coefficients;
  }

  setSmoothing(alpha: number) {
    this.alpha = Math.max(0.05, Math.min(1, alpha));
  }

  setViewport(width: number, height: number) {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  /**
   * Estimate gaze position from face landmarks.
   * Returns viewport-relative (x, y) in pixels.
   */
  estimate(landmarks: NormalizedLandmark[]): { x: number; y: number } | null {
    if (landmarks.length < 478) return null;

    const irisPos = this.getNormalizedIrisPosition(landmarks);
    if (!irisPos) return null;

    let screenX: number;
    let screenY: number;

    if (this.calibration) {
      const c = this.calibration;
      screenX = c.ax * irisPos.x + c.bx * irisPos.y + c.cx;
      screenY = c.ay * irisPos.x + c.by * irisPos.y + c.cy;
    } else {
      // Fallback: simple linear mapping (no calibration)
      // iris ratio ~0.3-0.7 maps to full viewport
      screenX = this.mapRange(irisPos.x, 0.3, 0.7, 0, this.viewportWidth);
      screenY = this.mapRange(irisPos.y, 0.3, 0.7, 0, this.viewportHeight);
    }

    // Clamp to viewport
    screenX = Math.max(0, Math.min(this.viewportWidth, screenX));
    screenY = Math.max(0, Math.min(this.viewportHeight, screenY));

    // Apply EMA smoothing
    this.smoothedX = this.alpha * screenX + (1 - this.alpha) * this.smoothedX;
    this.smoothedY = this.alpha * screenY + (1 - this.alpha) * this.smoothedY;

    return {
      x: Math.round(this.smoothedX),
      y: Math.round(this.smoothedY),
    };
  }

  /**
   * Get raw normalized iris position (for calibration data collection).
   * Returns values roughly in 0-1 range representing iris position within the eye.
   */
  getRawIrisPosition(
    landmarks: NormalizedLandmark[]
  ): { x: number; y: number } | null {
    return this.getNormalizedIrisPosition(landmarks);
  }

  private getNormalizedIrisPosition(
    landmarks: NormalizedLandmark[]
  ): { x: number; y: number } | null {
    // Average both eyes for stability
    const leftIris = landmarks[LEFT_IRIS_CENTER];
    const rightIris = landmarks[RIGHT_IRIS_CENTER];

    const leftInner = landmarks[LEFT_EYE_INNER];
    const leftOuter = landmarks[LEFT_EYE_OUTER];
    const rightInner = landmarks[RIGHT_EYE_INNER];
    const rightOuter = landmarks[RIGHT_EYE_OUTER];

    const leftTop = landmarks[LEFT_EYE_TOP];
    const leftBottom = landmarks[LEFT_EYE_BOTTOM];
    const rightTop = landmarks[RIGHT_EYE_TOP];
    const rightBottom = landmarks[RIGHT_EYE_BOTTOM];

    // Horizontal: iris position relative to eye corners
    const leftEyeWidth = Math.abs(leftOuter.x - leftInner.x);
    const rightEyeWidth = Math.abs(rightOuter.x - rightInner.x);

    if (leftEyeWidth < 0.001 || rightEyeWidth < 0.001) return null;

    const leftIrisRatioX =
      (leftIris.x - Math.min(leftOuter.x, leftInner.x)) / leftEyeWidth;
    const rightIrisRatioX =
      (rightIris.x - Math.min(rightOuter.x, rightInner.x)) / rightEyeWidth;

    // Vertical: iris position relative to eyelids
    const leftEyeHeight = Math.abs(leftTop.y - leftBottom.y);
    const rightEyeHeight = Math.abs(rightTop.y - rightBottom.y);

    if (leftEyeHeight < 0.001 || rightEyeHeight < 0.001) return null;

    const leftIrisRatioY =
      (leftIris.y - Math.min(leftTop.y, leftBottom.y)) / leftEyeHeight;
    const rightIrisRatioY =
      (rightIris.y - Math.min(rightTop.y, rightBottom.y)) / rightEyeHeight;

    // Average both eyes
    return {
      x: (leftIrisRatioX + rightIrisRatioX) / 2,
      y: (leftIrisRatioY + rightIrisRatioY) / 2,
    };
  }

  private mapRange(
    value: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number
  ): number {
    return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
  }
}
