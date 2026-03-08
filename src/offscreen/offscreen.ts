import {
  FaceLandmarker,
  HandLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
import type { GazeSettings } from "../shared/types.js";
import { DEFAULT_SETTINGS } from "../shared/types.js";
import { MEDIAPIPE_WASM_PATH, FACE_MODEL_PATH, HAND_MODEL_PATH } from "../shared/constants.js";
import { GazeEstimator } from "./gaze-estimator.js";
import { BlinkDetector } from "./blink-detector.js";
import { PinchDetector } from "./pinch-detector.js";

// ── State ──
let faceLandmarker: FaceLandmarker | null = null;
let handLandmarker: HandLandmarker | null = null;
let mediaStream: MediaStream | null = null;
let imgCapture: ImageCapture | null = null;
let canvas: HTMLCanvasElement | null = null;
let canvasCtx: CanvasRenderingContext2D | null = null;
let settings: GazeSettings = { ...DEFAULT_SETTINGS };
let isRunning = false;
let port: chrome.runtime.Port | null = null;
let initComplete = false;
let visionInstance: any = null;

const pendingMessages: any[] = [];

const gazeEstimator = new GazeEstimator();
const blinkDetector = new BlinkDetector();
const pinchDetector = new PinchDetector();

// ── Port connection to service worker ──

function connectPort() {
  port = chrome.runtime.connect({ name: "offscreen" });
  console.log("[Offscreen] Port opened");

  port.onMessage.addListener((message: any) => {
    if (!initComplete) {
      pendingMessages.push(message);
      return;
    }
    handleMessage(message);
  });

  port.onDisconnect.addListener(() => {
    console.log("[Offscreen] Port disconnected, reconnecting...");
    port = null;
    setTimeout(connectPort, 1000);
  });
}

function sendToSW(msg: any) {
  if (msg.type === "GAZE_UPDATE" || msg.type === "GAZE_CLICK" || msg.type === "TRACKING_STATUS") {
    chrome.runtime.sendMessage(msg).catch(() => {});
    return;
  }
  try {
    port?.postMessage(msg);
  } catch (err) {
    console.warn("[Offscreen] sendToSW failed:", err);
  }
}

function handleMessage(message: any) {
  const requestId = message._requestId;

  switch (message.type) {
    case "TOGGLE_TRACKING":
      if (message.enabled) {
        startTracking().then(() => {
          if (requestId) sendToSW({ _responseId: requestId, data: { ok: true } });
        });
      } else {
        stopTracking();
        if (requestId) sendToSW({ _responseId: requestId, data: { ok: true } });
      }
      break;

    case "SETTINGS_UPDATE":
      if (message.settings) Object.assign(settings, message.settings);
      applySettings();
      if (requestId) sendToSW({ _responseId: requestId, data: { ok: true } });
      break;

    case "CALIBRATION_COMPLETE":
      gazeEstimator.setCalibration(message.coefficients);
      console.log("[Offscreen] Calibration loaded from message");
      if (requestId) sendToSW({ _responseId: requestId, data: { ok: true } });
      break;

    case "REQUEST_CALIBRATION_SAMPLE":
      handleCalibrationSample(requestId);
      break;
  }
}

async function startTracking() {
  if (isRunning) return;

  // Lazy init: only request webcam + MediaPipe when tracking is first enabled.
  // Camera permission must have been granted by a visible page (calibration) first.
  if (!imgCapture) {
    console.log("[Offscreen] Initializing webcam...");
    try {
      await initWebcam();
    } catch (err) {
      console.error("[Offscreen] Webcam init failed:", err);
      sendToSW({ type: "TRACKING_STATUS", active: false, faceDetected: false, handDetected: false, error: "webcam_failed" });
      return;
    }
  }

  if (!faceLandmarker) {
    console.log("[Offscreen] Initializing MediaPipe...");
    try {
      await initMediaPipe();
      applySettings();
    } catch (err) {
      console.error("[Offscreen] MediaPipe init failed:", err);
      sendToSW({ type: "TRACKING_STATUS", active: false, faceDetected: false, handDetected: false, error: "mediapipe_failed" });
      return;
    }
  }

  isRunning = true;
  console.log("[Offscreen] ▶ Tracking STARTED");
  sendToSW({ type: "TRACKING_STATUS", active: true, faceDetected: false, handDetected: false });
  runLoop();
}

function stopTracking() {
  isRunning = false;
  console.log("[Offscreen] ⏹ Tracking STOPPED");
  sendToSW({ type: "TRACKING_STATUS", active: false, faceDetected: false, handDetected: false });
}

async function handleCalibrationSample(requestId?: string) {
  let result = { irisX: 0, irisY: 0 };

  if (faceLandmarker && imgCapture && canvasCtx && canvas) {
    try {
      const bitmap = await imgCapture.grabFrame();
      canvasCtx.drawImage(bitmap, 0, 0);
      bitmap.close();

      let ts = performance.now();
      if (ts <= lastTimestamp) ts = lastTimestamp + 1;
      lastTimestamp = ts;

      const faceResult = faceLandmarker.detectForVideo(canvas, ts);
      if (faceResult.faceLandmarks?.[0]) {
        const irisPos = gazeEstimator.getRawIrisPosition(faceResult.faceLandmarks[0]);
        if (irisPos) {
          result = { irisX: irisPos.x, irisY: irisPos.y };
        }
      }
    } catch (err) {
      console.warn("[Offscreen] Sample error:", err);
    }
  }

  if (requestId) sendToSW({ _responseId: requestId, data: result });
}

// ── Initialization ──

async function initMediaPipe() {
  const wasmUrl = chrome.runtime.getURL(MEDIAPIPE_WASM_PATH);
  const faceModelUrl = chrome.runtime.getURL(FACE_MODEL_PATH);

  console.log("[Offscreen] Loading WASM from:", wasmUrl);
  visionInstance = await FilesetResolver.forVisionTasks(wasmUrl);
  console.log("[Offscreen] WASM loaded OK");

  // Force CPU — GPU/WebGL is unreliable in offscreen documents
  console.log("[Offscreen] Creating FaceLandmarker with CPU...");
  faceLandmarker = await FaceLandmarker.createFromOptions(visionInstance, {
    baseOptions: {
      modelAssetPath: faceModelUrl,
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    refineLandmarks: true,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
    minFaceDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  console.log("[Offscreen] FaceLandmarker created with CPU");

  if (settings.clickMethod === "pinch") {
    await initHandLandmarker();
  }
}

async function initHandLandmarker() {
  if (handLandmarker) return;

  const handModelUrl = chrome.runtime.getURL(HAND_MODEL_PATH);
  handLandmarker = await HandLandmarker.createFromOptions(visionInstance, {
    baseOptions: {
      modelAssetPath: handModelUrl,
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  console.log("[Offscreen] HandLandmarker ready");
}

async function initWebcam() {
  console.log("[Offscreen] Requesting webcam...");

  mediaStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: 640, height: 480 },
  });

  // Use ImageCapture to grab frames directly from the camera track.
  // This bypasses the video element rendering pipeline entirely —
  // Chrome throttles/pauses video frame decoding in invisible offscreen docs,
  // but ImageCapture.grabFrame() reads directly from the camera hardware.
  const track = mediaStream.getVideoTracks()[0];
  const trackSettings = track.getSettings();
  const width = trackSettings.width || 640;
  const height = trackSettings.height || 480;

  imgCapture = new ImageCapture(track);
  console.log("[Offscreen] ImageCapture created, track:", width, "x", height);

  canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvasCtx = canvas.getContext("2d")!;
  console.log("[Offscreen] Canvas created:", width, "x", height);
}

function applySettings() {
  gazeEstimator.setSmoothing(settings.smoothingAlpha);
  blinkDetector.setMinDuration(settings.blinkDurationMs);
  blinkDetector.setCooldown(settings.blinkCooldownMs);
  pinchDetector.setThreshold(settings.pinchThreshold);
  pinchDetector.setCooldown(settings.pinchCooldownMs);

  if (settings.clickMethod === "pinch" && !handLandmarker) {
    initHandLandmarker();
  }
}

// ── Detection loop ──
// Uses async loop with ImageCapture.grabFrame() for reliable frame capture
// in offscreen documents where video element rendering is throttled.

let frameCount = 0;
let lastLogTime = 0;
let gazeSentCount = 0;
let lastTimestamp = 0;

async function runLoop() {
  while (isRunning) {
    const interval = Math.max(16, 1000 / settings.targetFps);
    await sleep(interval);

    if (!isRunning || !imgCapture || !faceLandmarker || !canvasCtx || !canvas) break;

    try {
      await processFrame();
    } catch (err) {
      console.warn("[Offscreen] Frame error:", err);
    }
  }
}

async function processFrame() {
  // Grab frame directly from camera track (not from video element)
  let bitmap: ImageBitmap;
  try {
    bitmap = await imgCapture!.grabFrame();
  } catch {
    // grabFrame can fail if track is temporarily busy — skip this frame
    return;
  }

  canvasCtx!.drawImage(bitmap, 0, 0);
  bitmap.close();

  let now = performance.now();
  if (now <= lastTimestamp) now = lastTimestamp + 1;
  lastTimestamp = now;

  let faceDetected = false;
  let gazeProduced = false;

  const faceResult = faceLandmarker!.detectForVideo(canvas!, now);

  if (faceResult.faceLandmarks && faceResult.faceLandmarks.length > 0) {
    faceDetected = true;
    const landmarks = faceResult.faceLandmarks[0];

    if (frameCount < 5) {
      console.log("[Offscreen] Landmarks:", landmarks.length, "iris:", landmarks.length >= 478);
    }

    const gaze = gazeEstimator.estimate(landmarks);
    if (gaze) {
      gazeProduced = true;
      gazeSentCount++;
      if (gazeSentCount <= 5 || gazeSentCount % 100 === 0) {
        console.log("[Offscreen] GAZE_UPDATE #" + gazeSentCount, "x:", gaze.x, "y:", gaze.y);
      }
      sendToSW({ type: "GAZE_UPDATE", x: gaze.x, y: gaze.y });

      if (settings.clickMethod === "blink") {
        const blinked = blinkDetector.detect(landmarks, now);
        if (blinked) {
          sendToSW({ type: "GAZE_CLICK", x: gaze.x, y: gaze.y, method: "blink" });
        }
      }
    }
  }

  if (settings.clickMethod === "pinch" && handLandmarker) {
    const handResult = handLandmarker.detectForVideo(canvas!, now);
    if (handResult.landmarks && handResult.landmarks.length > 0) {
      const pinched = pinchDetector.detect(handResult.landmarks[0], now);
      if (pinched) {
        const gaze2 = faceResult.faceLandmarks?.[0]
          ? gazeEstimator.estimate(faceResult.faceLandmarks[0])
          : null;
        if (gaze2) {
          sendToSW({ type: "GAZE_CLICK", x: gaze2.x, y: gaze2.y, method: "pinch" });
        }
      }
    }
  }

  frameCount++;

  if (now - lastLogTime > 5000) {
    console.log(`[Offscreen] Frame #${frameCount}: face=${faceDetected}, gaze=${gazeProduced}`);
    lastLogTime = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Bootstrap ──

async function start() {
  console.log("[Offscreen] === Starting offscreen document ===");

  connectPort();
  console.log("[Offscreen] Ready, waiting for tracking commands");

  finishInit();

  sendToSW({
    type: "TRACKING_STATUS",
    active: false,
    faceDetected: false,
    handDetected: false,
  });
}

function finishInit() {
  initComplete = true;
  for (const msg of pendingMessages) {
    handleMessage(msg);
  }
  pendingMessages.length = 0;
}

start();
