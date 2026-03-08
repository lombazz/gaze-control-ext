// ── MediaPipe local asset paths ──
// These resolve to chrome-extension://<id>/dist/mediapipe/...
export const MEDIAPIPE_WASM_PATH = "dist/mediapipe/wasm";
export const FACE_MODEL_PATH = "dist/mediapipe/models/face_landmarker.task";
export const HAND_MODEL_PATH = "dist/mediapipe/models/hand_landmarker.task";

// ── MediaPipe Face Landmark Indices ──

// Iris landmarks (FaceLandmarker with refine=true)
export const LEFT_IRIS = [468, 469, 470, 471, 472]; // center, right, top, left, bottom
export const RIGHT_IRIS = [473, 474, 475, 476, 477];

export const LEFT_IRIS_CENTER = 468;
export const RIGHT_IRIS_CENTER = 473;

// Eye corner landmarks
export const LEFT_EYE_INNER = 133;
export const LEFT_EYE_OUTER = 33;
export const RIGHT_EYE_INNER = 362;
export const RIGHT_EYE_OUTER = 263;

// Eye landmarks for EAR (Eye Aspect Ratio) calculation
// Left eye: p1=33, p2=160, p3=158, p4=133, p5=153, p6=144
export const LEFT_EYE_EAR = {
  p1: 33, // outer corner
  p2: 160, // upper lid 1
  p3: 158, // upper lid 2
  p4: 133, // inner corner
  p5: 153, // lower lid 1
  p6: 144, // lower lid 2
};

// Right eye: p1=362, p2=385, p3=387, p4=263, p5=373, p6=380
export const RIGHT_EYE_EAR = {
  p1: 362,
  p2: 385,
  p3: 387,
  p4: 263,
  p5: 373,
  p6: 380,
};

// Upper and lower eyelid landmarks for vertical reference
export const LEFT_EYE_TOP = 159;
export const LEFT_EYE_BOTTOM = 145;
export const RIGHT_EYE_TOP = 386;
export const RIGHT_EYE_BOTTOM = 374;

// ── MediaPipe Hand Landmark Indices ──
export const THUMB_TIP = 4;
export const INDEX_TIP = 8;
export const WRIST = 0;
export const MIDDLE_MCP = 9;

// ── Detection thresholds ──
export const EAR_BLINK_THRESHOLD = 0.2;
export const MIN_FACE_DETECTION_CONFIDENCE = 0.5;
export const MIN_HAND_DETECTION_CONFIDENCE = 0.5;

// ── Calibration ──
export const CALIBRATION_POINTS = [
  // 3x3 grid, expressed as fractions of viewport
  { x: 0.1, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.1, y: 0.5 },
  { x: 0.5, y: 0.5 },
  { x: 0.9, y: 0.5 },
  { x: 0.1, y: 0.9 },
  { x: 0.5, y: 0.9 },
  { x: 0.9, y: 0.9 },
];

export const CALIBRATION_HOLD_MS = 2000; // How long to hold gaze on each point
export const CALIBRATION_SAMPLES_PER_POINT = 10; // Samples to average per point
