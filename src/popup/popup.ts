import type { GazeSettings, ClickMethod } from "../shared/types.js";
import { DEFAULT_SETTINGS } from "../shared/types.js";

// ── DOM elements ──
const enableToggle = document.getElementById("enableToggle") as HTMLInputElement;
const statusDot = document.getElementById("statusDot") as HTMLElement;
const optBlink = document.getElementById("optBlink") as HTMLElement;
const optPinch = document.getElementById("optPinch") as HTMLElement;
const blinkDuration = document.getElementById("blinkDuration") as HTMLInputElement;
const blinkVal = document.getElementById("blinkVal") as HTMLElement;
const smoothing = document.getElementById("smoothing") as HTMLInputElement;
const smoothVal = document.getElementById("smoothVal") as HTMLElement;
const cursorSize = document.getElementById("cursorSize") as HTMLInputElement;
const cursorVal = document.getElementById("cursorVal") as HTMLElement;
const calibrateBtn = document.getElementById("calibrateBtn") as HTMLButtonElement;
const resetBtn = document.getElementById("resetBtn") as HTMLButtonElement;

let settings: GazeSettings = { ...DEFAULT_SETTINGS };

// ── Load settings ──

async function loadSettings() {
  const stored = await chrome.storage.local.get(["gazeSettings", "trackingStatus"]);
  if (stored.gazeSettings) {
    settings = { ...DEFAULT_SETTINGS, ...stored.gazeSettings };
  }

  // Update UI
  enableToggle.checked = settings.enabled;
  statusDot.classList.toggle("active", settings.enabled);
  selectMethod(settings.clickMethod);
  blinkDuration.value = String(settings.blinkDurationMs);
  blinkVal.textContent = `${settings.blinkDurationMs}ms`;
  smoothing.value = String(settings.smoothingAlpha);
  smoothVal.textContent = String(settings.smoothingAlpha);
  cursorSize.value = String(settings.cursorSize);
  cursorVal.textContent = `${settings.cursorSize}px`;
}

// ── Save and broadcast settings ──

async function saveSettings() {
  await chrome.storage.local.set({ gazeSettings: settings });
  chrome.runtime.sendMessage({
    type: "SETTINGS_UPDATE",
    settings,
  }).catch(() => {});
}

// ── Click method selection ──

function selectMethod(method: ClickMethod) {
  settings.clickMethod = method;
  optBlink.classList.toggle("selected", method === "blink");
  optPinch.classList.toggle("selected", method === "pinch");
}

optBlink.addEventListener("click", () => {
  selectMethod("blink");
  saveSettings();
});

optPinch.addEventListener("click", () => {
  selectMethod("pinch");
  saveSettings();
});

// ── Toggle ──

enableToggle.addEventListener("change", () => {
  settings.enabled = enableToggle.checked;
  statusDot.classList.toggle("active", settings.enabled);
  saveSettings();
  chrome.runtime.sendMessage({
    type: "TOGGLE_TRACKING",
    enabled: settings.enabled,
  }).catch(() => {});
});

// ── Sliders ──

blinkDuration.addEventListener("input", () => {
  settings.blinkDurationMs = Number(blinkDuration.value);
  blinkVal.textContent = `${blinkDuration.value}ms`;
  saveSettings();
});

smoothing.addEventListener("input", () => {
  settings.smoothingAlpha = Number(smoothing.value);
  smoothVal.textContent = smoothing.value;
  saveSettings();
});

cursorSize.addEventListener("input", () => {
  settings.cursorSize = Number(cursorSize.value);
  cursorVal.textContent = `${cursorSize.value}px`;
  saveSettings();
});

// ── Calibration ──

calibrateBtn.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("dist/calibration/calibration.html"),
  });
  window.close();
});

resetBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("calibration");
  chrome.runtime.sendMessage({
    type: "CALIBRATION_COMPLETE",
    coefficients: { ax: 0, bx: 0, cx: 0, ay: 0, by: 0, cy: 0 },
  }).catch(() => {});
  resetBtn.textContent = "Reset!";
  setTimeout(() => (resetBtn.textContent = "Reset Calibration"), 1500);
});

// ── Init ──
loadSettings();
