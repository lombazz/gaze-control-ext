# Gaze Control

Control your browser with eye gaze and hand gestures. A Chrome extension (Manifest V3) that turns your webcam into a pointer: your eyes move the cursor, a blink or a thumb-index pinch clicks.

All vision processing runs locally in the browser via [MediaPipe Tasks](https://developers.google.com/mediapipe). No video or landmark data leaves your machine.

## Features

- Webcam-based gaze tracking using MediaPipe FaceLandmarker (with iris refinement)
- Two click modes: blink or thumb-index pinch (HandLandmarker)
- 9-point (3x3) calibration with per-point averaging
- On-page cursor overlay injected into every tab
- Adjustable smoothing, blink-duration threshold, and cursor size
- Keyboard shortcut `Alt+G` to toggle tracking

## Requirements

- Chrome / Chromium 116+ (Manifest V3 with offscreen documents)
- Webcam access
- Node.js 18+ to build from source

## Install (development)

```bash
git clone https://github.com/lombazz/gaze-control-ext.git
cd gaze-control-ext
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the repo root (the folder containing `manifest.json`)

The extension loads from the built `dist/` directory referenced by `manifest.json`.

For iterative development:

```bash
npm run dev    # vite build --watch
```

Reload the extension from `chrome://extensions` after changes.

## Usage

1. Click the extension icon to open the popup.
2. Toggle **Enable Tracking** on (you'll be prompted for camera access the first time).
3. Click **Calibrate Gaze** and follow the 9 points on screen, holding your gaze on each.
4. Choose your click method (Blink or Pinch) and tune Sensitivity sliders to taste.
5. Press `Alt+G` at any time to toggle tracking on/off.

## Privacy

- Camera frames are processed in an [offscreen document](https://developer.chrome.com/docs/extensions/reference/api/offscreen) inside your browser.
- MediaPipe WASM runtime and `.task` models are bundled in the extension and loaded from `chrome-extension://...`. No model downloads or remote inference.
- The extension does not send images, landmarks, or telemetry anywhere.

## Architecture

```
popup        UI for toggles, sliders, calibration entry
service-worker  routes messages, manages state, owns the offscreen doc
offscreen    holds the webcam + MediaPipe; emits gaze/click events
  ├─ gaze-estimator    iris + eye-corner -> screen coords
  ├─ blink-detector    EAR (Eye Aspect Ratio) threshold
  └─ pinch-detector    thumb-tip / index-tip distance
content-script  draws the cursor overlay and dispatches synthetic clicks
calibration  fullscreen 3x3 calibration page
```

Messaging: popup and content scripts talk to the service worker, which proxies to the offscreen document. Calibration data and user settings are persisted via `chrome.storage`.

## Project structure

```
src/
  background/    service worker (routing, state)
  offscreen/     webcam + MediaPipe inference
  content/       cursor overlay + click dispatch
  popup/         extension popup UI
  calibration/   9-point calibration page
  shared/        landmark indices, thresholds, types
assets/
  icons/         extension icons
  mediapipe/     bundled WASM + .task models (copied to dist/ at build time)
```

## Build

`vite build` compiles each entry point (`background`, `offscreen`, `content`, `popup`, `calibration`) into `dist/<name>/<name>.js`. A small Vite plugin in `vite.config.ts` then copies the HTML files, the cursor CSS, the icon set, and the MediaPipe WASM + model assets into `dist/`. The shipped `manifest.json` points at those built paths.

```bash
npm run build   # one-shot build
npm run dev     # rebuild on change
npm run clean   # remove dist/
```

## Status

Version 0.1.0. Early prototype; expect rough edges in calibration accuracy and click reliability depending on lighting and camera quality.
