import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { THUMB_TIP, INDEX_TIP, WRIST, MIDDLE_MCP } from "../shared/constants.js";

export class PinchDetector {
  private isPinching = false;
  private lastClickTime = 0;
  private threshold = 0.06;
  private cooldownMs = 400;

  setThreshold(threshold: number) {
    this.threshold = threshold;
  }

  setCooldown(ms: number) {
    this.cooldownMs = ms;
  }

  /**
   * Process hand landmarks and return true if a pinch-release click is detected.
   * Click fires when thumb-index pinch is released (like mouseup).
   */
  detect(landmarks: NormalizedLandmark[], timestamp: number): boolean {
    const thumbTip = landmarks[THUMB_TIP];
    const indexTip = landmarks[INDEX_TIP];
    const wrist = landmarks[WRIST];
    const middleMcp = landmarks[MIDDLE_MCP];

    // Normalize distance by hand size (wrist to middle MCP)
    const handSize = this.distance(wrist, middleMcp);
    if (handSize < 0.01) return false;

    const pinchDistance = this.distance(thumbTip, indexTip) / handSize;
    const currentlyPinching = pinchDistance < this.threshold;

    // Detect release: was pinching, now not pinching
    if (this.isPinching && !currentlyPinching) {
      this.isPinching = false;

      if (timestamp - this.lastClickTime >= this.cooldownMs) {
        this.lastClickTime = timestamp;
        return true;
      }
    }

    this.isPinching = currentlyPinching;
    return false;
  }

  private distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  }
}
