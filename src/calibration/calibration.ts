import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { CalibrationCoefficients } from "../shared/types.js";
import {
  CALIBRATION_POINTS,
  CALIBRATION_SAMPLES_PER_POINT,
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
  MEDIAPIPE_WASM_PATH,
  FACE_MODEL_PATH,
} from "../shared/constants.js";

// ── DOM ──
const instructions = document.getElementById("instructions") as HTMLElement;
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const calDot = document.getElementById("calDot") as HTMLElement;
const progress = document.getElementById("progress") as HTMLElement;
const progressText = document.getElementById("progressText") as HTMLElement;
const progressFill = document.getElementById("progressFill") as HTMLElement;
const result = document.getElementById("result") as HTMLElement;
const doneBtn = document.getElementById("doneBtn") as HTMLButtonElement;

// ── State ──
let faceLandmarker: FaceLandmarker | null = null;
let video: HTMLVideoElement | null = null;

interface CalibrationSamplePair {
  irisX: number;
  irisY: number;
  screenX: number;
  screenY: number;
}

const collectedData: CalibrationSamplePair[] = [];

// ── Initialize webcam + MediaPipe directly in this page ──

async function initWebcam(): Promise<HTMLVideoElement> {
  const vid = document.createElement("video");
  vid.setAttribute("autoplay", "");
  vid.setAttribute("playsinline", "");
  vid.style.position = "fixed";
  vid.style.bottom = "16px";
  vid.style.right = "16px";
  vid.style.width = "200px";
  vid.style.borderRadius = "8px";
  vid.style.border = "2px solid #444";
  vid.style.zIndex = "100";
  vid.style.transform = "scaleX(-1)"; // mirror
  document.body.appendChild(vid);

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: 640, height: 480 },
  });
  vid.srcObject = stream;

  // Wait for video to be ready before playing
  if (vid.readyState < 2) {
    await new Promise<void>((resolve) => {
      vid.onloadeddata = () => resolve();
    });
  }
  await vid.play();
  return vid;
}

async function initMediaPipe(): Promise<FaceLandmarker> {
  const wasmUrl = chrome.runtime.getURL(MEDIAPIPE_WASM_PATH);
  const modelUrl = chrome.runtime.getURL(FACE_MODEL_PATH);

  const vision = await FilesetResolver.forVisionTasks(wasmUrl);

  const fl = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelUrl,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    refineLandmarks: true,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
    minFaceDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  return fl;
}

// ── Iris extraction (same logic as gaze-estimator) ──

function getIrisPosition(
  landmarks: NormalizedLandmark[]
): { x: number; y: number } | null {
  if (landmarks.length < 478) return null;

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

  const leftEyeWidth = Math.abs(leftOuter.x - leftInner.x);
  const rightEyeWidth = Math.abs(rightOuter.x - rightInner.x);
  if (leftEyeWidth < 0.001 || rightEyeWidth < 0.001) return null;

  const leftIrisRatioX =
    (leftIris.x - Math.min(leftOuter.x, leftInner.x)) / leftEyeWidth;
  const rightIrisRatioX =
    (rightIris.x - Math.min(rightOuter.x, rightInner.x)) / rightEyeWidth;

  const leftEyeHeight = Math.abs(leftTop.y - leftBottom.y);
  const rightEyeHeight = Math.abs(rightTop.y - rightBottom.y);
  if (leftEyeHeight < 0.001 || rightEyeHeight < 0.001) return null;

  const leftIrisRatioY =
    (leftIris.y - Math.min(leftTop.y, leftBottom.y)) / leftEyeHeight;
  const rightIrisRatioY =
    (rightIris.y - Math.min(rightTop.y, rightBottom.y)) / rightEyeHeight;

  return {
    x: (leftIrisRatioX + rightIrisRatioX) / 2,
    y: (leftIrisRatioY + rightIrisRatioY) / 2,
  };
}

// ── Get a single iris sample ──

function sampleIris(): { x: number; y: number } | null {
  if (!faceLandmarker || !video || video.readyState < 2) return null;

  try {
    const result = faceLandmarker.detectForVideo(video, performance.now());
    if (result.faceLandmarks?.[0]) {
      return getIrisPosition(result.faceLandmarks[0]);
    }
  } catch {}
  return null;
}

// ── Collect samples for one calibration point ──

async function collectPointSamples(
  screenX: number,
  screenY: number
): Promise<boolean> {
  let collected = 0;
  let attempts = 0;
  const maxAttempts = 40;

  calDot.classList.add("collecting");

  while (collected < CALIBRATION_SAMPLES_PER_POINT && attempts < maxAttempts) {
    await sleep(200);
    attempts++;

    const iris = sampleIris();
    if (iris) {
      collectedData.push({
        irisX: iris.x,
        irisY: iris.y,
        screenX,
        screenY,
      });
      collected++;
    }
  }

  calDot.classList.remove("collecting");

  if (collected > 0) {
    calDot.classList.add("done");
    await sleep(300);
    calDot.classList.remove("done");
  }

  return collected > 0;
}

// ── Run calibration ──

async function runCalibration() {
  instructions.style.display = "none";
  progress.style.display = "block";
  progressText.textContent = "Starting webcam...";

  try {
    video = await initWebcam();
    progressText.textContent = "Loading face detection model...";
  } catch (err) {
    progressText.textContent = `Webcam error: ${err}. Check camera permissions.`;
    console.error("[Calibration] Webcam error:", err);
    return;
  }

  try {
    faceLandmarker = await initMediaPipe();
    progressText.textContent = "Models loaded! Detecting face...";
  } catch (err) {
    progressText.textContent = `Model loading error: ${err}`;
    console.error("[Calibration] MediaPipe error:", err);
    return;
  }

  // Wait for face detection to work
  let faceOk = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const iris = sampleIris();
    if (iris) {
      faceOk = true;
      break;
    }
    progressText.textContent = `Detecting face... (${i + 1}s) — look at the camera`;
  }

  if (!faceOk) {
    progressText.textContent = "Could not detect face. Make sure your face is visible.";
    return;
  }

  // Start calibration points
  calDot.classList.add("active");
  collectedData.length = 0;

  for (let i = 0; i < CALIBRATION_POINTS.length; i++) {
    const point = CALIBRATION_POINTS[i];
    const sx = point.x * window.innerWidth;
    const sy = point.y * window.innerHeight;

    calDot.style.left = `${sx}px`;
    calDot.style.top = `${sy}px`;
    calDot.classList.remove("collecting", "done");

    progressText.textContent = `Point ${i + 1} of ${CALIBRATION_POINTS.length} — look at the dot`;
    progressFill.style.width = `${((i + 1) / CALIBRATION_POINTS.length) * 100}%`;

    // Give user time to look at the dot
    await sleep(1000);

    await collectPointSamples(sx, sy);
  }

  calDot.classList.remove("active");
  progress.style.display = "none";

  // Stop webcam
  if (video.srcObject instanceof MediaStream) {
    video.srcObject.getTracks().forEach((t) => t.stop());
  }
  video.remove();

  // Fit model
  const coefficients = fitCalibration(collectedData);
  console.log("[Calibration] Done!", coefficients, `${collectedData.length} samples`);

  // Save
  await chrome.storage.local.set({ calibration: coefficients });

  // Notify offscreen doc (if running)
  chrome.runtime
    .sendMessage({ type: "CALIBRATION_COMPLETE", coefficients })
    .catch(() => {});

  result.style.display = "block";
}

// ── Least-squares linear regression ──

function fitCalibration(data: CalibrationSamplePair[]): CalibrationCoefficients {
  if (data.length < 3) {
    return {
      ax: window.innerWidth, bx: 0, cx: 0,
      ay: 0, by: window.innerHeight, cy: 0,
    };
  }

  const n = data.length;
  let sumIx = 0, sumIy = 0;
  let sumIx2 = 0, sumIy2 = 0, sumIxIy = 0;
  let sumSx = 0, sumSy = 0;
  let sumIxSx = 0, sumIySx = 0;
  let sumIxSy = 0, sumIySy = 0;

  for (const d of data) {
    sumIx += d.irisX;
    sumIy += d.irisY;
    sumIx2 += d.irisX * d.irisX;
    sumIy2 += d.irisY * d.irisY;
    sumIxIy += d.irisX * d.irisY;
    sumSx += d.screenX;
    sumSy += d.screenY;
    sumIxSx += d.irisX * d.screenX;
    sumIySx += d.irisY * d.screenX;
    sumIxSy += d.irisX * d.screenY;
    sumIySy += d.irisY * d.screenY;
  }

  const xC = solve3x3(
    sumIx2, sumIxIy, sumIx,
    sumIxIy, sumIy2, sumIy,
    sumIx, sumIy, n,
    sumIxSx, sumIySx, sumSx
  );
  const yC = solve3x3(
    sumIx2, sumIxIy, sumIx,
    sumIxIy, sumIy2, sumIy,
    sumIx, sumIy, n,
    sumIxSy, sumIySy, sumSy
  );

  return { ax: xC[0], bx: xC[1], cx: xC[2], ay: yC[0], by: yC[1], cy: yC[2] };
}

function solve3x3(
  a11: number, a12: number, a13: number,
  a21: number, a22: number, a23: number,
  a31: number, a32: number, a33: number,
  b1: number, b2: number, b3: number
): [number, number, number] {
  const det =
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31);

  if (Math.abs(det) < 1e-10) return [0, 0, 0];

  const d1 =
    b1 * (a22 * a33 - a23 * a32) -
    a12 * (b2 * a33 - a23 * b3) +
    a13 * (b2 * a32 - a22 * b3);
  const d2 =
    a11 * (b2 * a33 - a23 * b3) -
    b1 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * b3 - b2 * a31);
  const d3 =
    a11 * (a22 * b3 - b2 * a32) -
    a12 * (a21 * b3 - b2 * a31) +
    b1 * (a21 * a32 - a22 * a31);

  return [d1 / det, d2 / det, d3 / det];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Events ──
startBtn.addEventListener("click", () => runCalibration());
doneBtn.addEventListener("click", () => window.close());
