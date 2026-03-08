import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  LEFT_EYE_EAR,
  RIGHT_EYE_EAR,
  EAR_BLINK_THRESHOLD,
} from "../shared/constants.js";

export class BlinkDetector {
  private blinkStartTime: number | null = null;
  private lastClickTime = 0;
  private minDurationMs = 300;
  private cooldownMs = 500;

  setMinDuration(ms: number) {
    this.minDurationMs = ms;
  }

  setCooldown(ms: number) {
    this.cooldownMs = ms;
  }

  /**
   * Process face landmarks and return true if a deliberate blink-click is detected.
   * A blink-click fires when eyes reopen after being closed for >= minDurationMs.
   */
  detect(landmarks: NormalizedLandmark[], timestamp: number): boolean {
    const leftEAR = this.computeEAR(landmarks, LEFT_EYE_EAR);
    const rightEAR = this.computeEAR(landmarks, RIGHT_EYE_EAR);
    const avgEAR = (leftEAR + rightEAR) / 2;

    const eyesClosed = avgEAR < EAR_BLINK_THRESHOLD;

    if (eyesClosed) {
      // Eyes just closed — record start time
      if (this.blinkStartTime === null) {
        this.blinkStartTime = timestamp;
      }
    } else {
      // Eyes open — check if we had a deliberate blink
      if (this.blinkStartTime !== null) {
        const blinkDuration = timestamp - this.blinkStartTime;
        this.blinkStartTime = null;

        if (
          blinkDuration >= this.minDurationMs &&
          timestamp - this.lastClickTime >= this.cooldownMs
        ) {
          this.lastClickTime = timestamp;
          return true;
        }
      }
    }

    return false;
  }

  private computeEAR(
    landmarks: NormalizedLandmark[],
    eyeIndices: { p1: number; p2: number; p3: number; p4: number; p5: number; p6: number }
  ): number {
    const p1 = landmarks[eyeIndices.p1];
    const p2 = landmarks[eyeIndices.p2];
    const p3 = landmarks[eyeIndices.p3];
    const p4 = landmarks[eyeIndices.p4];
    const p5 = landmarks[eyeIndices.p5];
    const p6 = landmarks[eyeIndices.p6];

    const vertical1 = this.distance(p2, p6);
    const vertical2 = this.distance(p3, p5);
    const horizontal = this.distance(p1, p4);

    if (horizontal < 0.001) return 1; // Avoid division by zero, assume open

    return (vertical1 + vertical2) / (2 * horizontal);
  }

  private distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }
}
