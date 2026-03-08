import type { ExtensionMessage, GazeSettings } from "../shared/types.js";
import { DEFAULT_SETTINGS } from "../shared/types.js";

let offscreenPort: chrome.runtime.Port | null = null;
let portReadyPromise: Promise<void> | null = null;
let portReadyResolve: (() => void) | null = null;

// Pending responses for request/reply messages
const pendingResponses = new Map<string, (response: any) => void>();

// ── Offscreen document lifecycle ──

async function ensureOffscreenAndPort(): Promise<boolean> {
  // Create document if needed
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (existingContexts.length === 0) {
    // Set up the port-ready promise BEFORE creating the document
    portReadyPromise = new Promise((resolve) => {
      portReadyResolve = resolve;
    });

    await chrome.offscreen.createDocument({
      url: "dist/offscreen/offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Webcam access for gaze tracking with MediaPipe",
    });
    console.log("[GazeControl] Offscreen document created");
  }

  // Wait for port to connect (with timeout)
  if (!offscreenPort && portReadyPromise) {
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("Port connection timeout")), 10000)
    );
    try {
      await Promise.race([portReadyPromise, timeout]);
    } catch {
      console.warn("[GazeControl] Port connection timed out");
      return false;
    }
  }

  return !!offscreenPort;
}

// ── Port-based communication with offscreen doc ──

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "offscreen") {
    offscreenPort = port;
    console.log("[GazeControl] Offscreen port connected");

    // Resolve any pending waiters
    if (portReadyResolve) {
      portReadyResolve();
      portReadyResolve = null;
      portReadyPromise = null;
    }

    // Send settings and calibration to offscreen doc (it can't access chrome.storage)
    sendInitDataToOffscreen();

    let gazeMessageCount = 0;

    port.onMessage.addListener((message: any) => {
      // Response to a pending request
      if (message._responseId && pendingResponses.has(message._responseId)) {
        const resolve = pendingResponses.get(message._responseId)!;
        pendingResponses.delete(message._responseId);
        resolve(message.data);
        return;
      }

      // Forward gaze/click messages to active tab
      if (message.type === "GAZE_UPDATE" || message.type === "GAZE_CLICK") {
        gazeMessageCount++;
        if (gazeMessageCount <= 5 || gazeMessageCount % 100 === 0) {
          console.log("[GazeControl] Received from offscreen:", message.type,
            "#" + gazeMessageCount, "x:", message.x, "y:", message.y);
        }
        forwardToActiveTab(message);
      } else if (message.type === "TRACKING_STATUS") {
        chrome.storage.local.set({ trackingStatus: message });
        // Show badge indicator
        if (message.error) {
          chrome.action.setBadgeText({ text: "ERR" });
          chrome.action.setBadgeBackgroundColor({ color: "#EA4335" });
        } else if (message.active) {
          chrome.action.setBadgeText({ text: "ON" });
          chrome.action.setBadgeBackgroundColor({ color: "#34A853" });
        } else {
          chrome.action.setBadgeText({ text: "OFF" });
          chrome.action.setBadgeBackgroundColor({ color: "#888" });
        }
      }
    });

    port.onDisconnect.addListener(() => {
      offscreenPort = null;
      portReadyPromise = null;
      portReadyResolve = null;
      console.log("[GazeControl] Offscreen port disconnected");
    });
  }
});

function sendToOffscreen(message: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!offscreenPort) {
      reject(new Error("Offscreen port not connected"));
      return;
    }
    const requestId = Math.random().toString(36).slice(2);
    pendingResponses.set(requestId, resolve);

    setTimeout(() => {
      if (pendingResponses.has(requestId)) {
        pendingResponses.delete(requestId);
        reject(new Error("Offscreen response timeout"));
      }
    }, 5000);

    offscreenPort.postMessage({ ...message, _requestId: requestId });
  });
}

async function sendInitDataToOffscreen() {
  try {
    const stored = await chrome.storage.local.get(["gazeSettings", "calibration"]);
    if (stored.gazeSettings) {
      fireAndForgetToOffscreen({ type: "SETTINGS_UPDATE", settings: stored.gazeSettings });
    }
    if (stored.calibration) {
      fireAndForgetToOffscreen({ type: "CALIBRATION_COMPLETE", coefficients: stored.calibration });
    }
    console.log("[GazeControl] Sent init data to offscreen");
  } catch (err) {
    console.warn("[GazeControl] Failed to send init data:", err);
  }
}

function fireAndForgetToOffscreen(message: any) {
  if (offscreenPort) {
    offscreenPort.postMessage(message);
  } else {
    console.warn("[GazeControl] Cannot send, port not ready:", message.type);
  }
}

// ── Message routing from popup/calibration/content ──

let gazeForwardCount = 0;

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    // Gaze updates from offscreen doc (sent via sendMessage for reliability)
    if (message.type === "GAZE_UPDATE" || message.type === "GAZE_CLICK") {
      gazeForwardCount++;
      if (gazeForwardCount <= 5 || gazeForwardCount % 200 === 0) {
        console.log("[GazeControl] Received", message.type, "#" + gazeForwardCount,
          "x:", message.x, "y:", message.y);
      }
      forwardToActiveTab(message);
      return false; // synchronous, no response needed
    }

    // Tracking status from offscreen doc
    if (message.type === "TRACKING_STATUS") {
      chrome.storage.local.set({ trackingStatus: message });
      if ((message as any).error) {
        chrome.action.setBadgeText({ text: "ERR" });
        chrome.action.setBadgeBackgroundColor({ color: "#EA4335" });
      } else if ((message as any).active) {
        chrome.action.setBadgeText({ text: "ON" });
        chrome.action.setBadgeBackgroundColor({ color: "#34A853" });
      } else {
        chrome.action.setBadgeText({ text: "OFF" });
        chrome.action.setBadgeBackgroundColor({ color: "#888" });
      }
      return false;
    }

    // Calibration complete → start tracking
    if (message.type === "CALIBRATION_COMPLETE") {
      handleCalibrationComplete(message).then(() => sendResponse({ ok: true }));
      return true;
    }

    // Toggle tracking
    if (message.type === "TOGGLE_TRACKING") {
      handleToggle(message).then(() => sendResponse({ ok: true }));
      return true;
    }

    // Settings update
    if (message.type === "SETTINGS_UPDATE") {
      // Just save and forward if port available
      chrome.storage.local.get("gazeSettings").then((stored) => {
        const settings = { ...DEFAULT_SETTINGS, ...stored.gazeSettings, ...message.settings };
        chrome.storage.local.set({ gazeSettings: settings });
        fireAndForgetToOffscreen(message);
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "REQUEST_CALIBRATION_SAMPLE") {
      ensureOffscreenAndPort()
        .then((ok) => ok ? sendToOffscreen(message) : { irisX: 0, irisY: 0 })
        .then((response) => sendResponse(response))
        .catch(() => sendResponse({ irisX: 0, irisY: 0 }));
      return true;
    }
  }
);

async function handleCalibrationComplete(message: any) {
  // Save calibration data
  await chrome.storage.local.set({ calibration: message.coefficients });

  // Ensure offscreen doc exists and port is connected
  const ok = await ensureOffscreenAndPort();
  if (ok) {
    // Send calibration data
    fireAndForgetToOffscreen(message);
    // Start tracking
    fireAndForgetToOffscreen({ type: "TOGGLE_TRACKING", enabled: true });
    console.log("[GazeControl] Calibration applied, tracking started");
  } else {
    console.warn("[GazeControl] Could not start tracking after calibration");
  }

  // Update settings to enabled
  const stored = await chrome.storage.local.get("gazeSettings");
  const settings = { ...DEFAULT_SETTINGS, ...stored.gazeSettings, enabled: true };
  await chrome.storage.local.set({ gazeSettings: settings });
}

async function handleToggle(message: any) {
  const stored = await chrome.storage.local.get("gazeSettings");
  const settings = { ...DEFAULT_SETTINGS, ...stored.gazeSettings, enabled: message.enabled };
  await chrome.storage.local.set({ gazeSettings: settings });

  if (message.enabled) {
    const ok = await ensureOffscreenAndPort();
    if (ok) {
      fireAndForgetToOffscreen(message);
    }
  } else {
    fireAndForgetToOffscreen(message);
  }
}

let lastTabId: number | null = null;
let injectedTabs = new Set<number>();
let forwardLogCount = 0;

async function forwardToActiveTab(message: any) {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id || !tab.url) {
      if (forwardLogCount < 3) {
        console.warn("[GazeControl] No active tab found");
        forwardLogCount++;
      }
      return;
    }

    // Skip chrome://, edge://, about: pages — content scripts can't run there
    if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") ||
        tab.url.startsWith("about:") || tab.url.startsWith("chrome-extension://")) {
      if (forwardLogCount < 3) {
        console.warn("[GazeControl] Skipping restricted URL:", tab.url.substring(0, 40));
        forwardLogCount++;
      }
      return;
    }

    // If tab changed, try to inject content script (for tabs opened before extension load)
    if (tab.id !== lastTabId) {
      lastTabId = tab.id;
      forwardLogCount = 0;
      if (!injectedTabs.has(tab.id)) {
        await tryInjectContentScript(tab.id);
        injectedTabs.add(tab.id);
      }
    }

    await chrome.tabs.sendMessage(tab.id, message);
    if (forwardLogCount < 3) {
      console.log("[GazeControl] Forwarded", message.type, "to tab", tab.id);
      forwardLogCount++;
    }
  } catch (err) {
    if (forwardLogCount < 5) {
      console.warn("[GazeControl] Forward failed:", (err as Error).message);
      forwardLogCount++;
    }
  }
}

async function tryInjectContentScript(tabId: number) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["dist/content/content-script.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["dist/content/cursor-overlay.css"],
    });
    console.log("[GazeControl] Injected content script into tab", tabId);
  } catch (err) {
    // Already injected or can't inject on this page
    console.log("[GazeControl] Inject skipped:", (err as Error).message);
  }
}

// Clean up tracking when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

// ── Keyboard shortcut ──

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-tracking") {
    const stored = await chrome.storage.local.get("gazeSettings");
    const settings: GazeSettings = {
      ...DEFAULT_SETTINGS,
      ...stored.gazeSettings,
    };
    settings.enabled = !settings.enabled;
    await handleToggle({ type: "TOGGLE_TRACKING", enabled: settings.enabled });
    console.log(`[GazeControl] Tracking ${settings.enabled ? "enabled" : "disabled"}`);
  }
});

// ── Extension install/startup ──

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.local.set({ gazeSettings: DEFAULT_SETTINGS });
    console.log("[GazeControl] Extension installed, defaults set");
  } else {
    console.log("[GazeControl] Extension reloaded, preserving settings");
    // Don't auto-start on reload — camera permission is reset on extension reload.
    // User needs to recalibrate (which re-grants camera permission).
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#888" });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await autoStartIfEnabled();
});

async function autoStartIfEnabled() {
  const stored = await chrome.storage.local.get(["gazeSettings", "calibration"]);
  const settings = stored.gazeSettings;
  if (settings?.enabled && stored.calibration) {
    console.log("[GazeControl] Auto-starting tracking (enabled + calibration found)");
    const ok = await ensureOffscreenAndPort();
    if (ok) {
      fireAndForgetToOffscreen({ type: "TOGGLE_TRACKING", enabled: true });
    }
  } else {
    console.log("[GazeControl] Not auto-starting: enabled=", settings?.enabled,
      "hasCalibration=", !!stored.calibration);
  }
}
