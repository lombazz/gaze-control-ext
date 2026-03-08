// ── Message types between extension contexts ──

export type ClickMethod = "blink" | "pinch";

export interface GazeUpdate {
  type: "GAZE_UPDATE";
  x: number;
  y: number;
}

export interface GazeClick {
  type: "GAZE_CLICK";
  x: number;
  y: number;
  method: ClickMethod;
}

export interface TrackingStatus {
  type: "TRACKING_STATUS";
  active: boolean;
  faceDetected: boolean;
  handDetected: boolean;
}

export interface ToggleTracking {
  type: "TOGGLE_TRACKING";
  enabled: boolean;
}

export interface SettingsUpdate {
  type: "SETTINGS_UPDATE";
  settings: Partial<GazeSettings>;
}

export interface CalibrationData {
  type: "CALIBRATION_DATA";
  point: { irisX: number; irisY: number; screenX: number; screenY: number };
}

export interface CalibrationComplete {
  type: "CALIBRATION_COMPLETE";
  coefficients: CalibrationCoefficients;
}

export interface RequestCalibrationSample {
  type: "REQUEST_CALIBRATION_SAMPLE";
}

export interface CalibrationSample {
  type: "CALIBRATION_SAMPLE";
  irisX: number;
  irisY: number;
}

export type ExtensionMessage =
  | GazeUpdate
  | GazeClick
  | TrackingStatus
  | ToggleTracking
  | SettingsUpdate
  | CalibrationData
  | CalibrationComplete
  | RequestCalibrationSample
  | CalibrationSample;

// ── Settings ──

export interface GazeSettings {
  enabled: boolean;
  clickMethod: ClickMethod;
  blinkDurationMs: number; // min ms eyes must be closed for deliberate blink
  blinkCooldownMs: number;
  pinchThreshold: number; // normalized distance below which = pinch
  pinchCooldownMs: number;
  smoothingAlpha: number; // EMA smoothing factor (0-1, lower = smoother)
  cursorSize: number; // px
  targetFps: number;
}

export const DEFAULT_SETTINGS: GazeSettings = {
  enabled: true,
  clickMethod: "blink",
  blinkDurationMs: 300,
  blinkCooldownMs: 500,
  pinchThreshold: 0.06,
  pinchCooldownMs: 400,
  smoothingAlpha: 0.3,
  cursorSize: 24,
  targetFps: 20,
};

// ── Calibration ──

export interface CalibrationCoefficients {
  // screen_x = ax * irisX + bx * irisY + cx
  ax: number;
  bx: number;
  cx: number;
  // screen_y = ay * irisX + by * irisY + cy
  ay: number;
  by: number;
  cy: number;
}
