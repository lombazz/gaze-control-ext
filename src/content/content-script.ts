import type { ExtensionMessage } from "../shared/types.js";

// ── Create cursor elements ──

const cursor = document.createElement("div");
cursor.id = "gaze-cursor";
document.documentElement.appendChild(cursor);

const ripple = document.createElement("div");
ripple.id = "gaze-cursor-ripple";
document.documentElement.appendChild(ripple);

let cursorX = 0;
let cursorY = 0;
let isActive = false;

// ── Message handling ──

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, _sendResponse) => {
    switch (message.type) {
      case "GAZE_UPDATE":
        updateCursor(message.x, message.y);
        break;
      case "GAZE_CLICK":
        performClick(message.x, message.y);
        break;
      case "TOGGLE_TRACKING":
        if (message.enabled) {
          cursor.classList.add("active");
          isActive = true;
        } else {
          cursor.classList.remove("active");
          isActive = false;
        }
        break;
    }
  }
);

// ── Cursor movement ──

function updateCursor(x: number, y: number) {
  cursorX = x;
  cursorY = y;

  if (!isActive) {
    cursor.classList.add("active");
    isActive = true;
  }

  cursor.style.left = `${x}px`;
  cursor.style.top = `${y}px`;
}

// ── Click dispatch ──

function performClick(x: number, y: number) {
  updateCursor(x, y);

  // Visual feedback
  cursor.classList.add("clicking");
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  ripple.classList.remove("animate");
  // Force reflow to restart animation
  void ripple.offsetWidth;
  ripple.classList.add("animate");

  setTimeout(() => cursor.classList.remove("clicking"), 200);

  // Find element at gaze point
  // Temporarily hide cursor so elementFromPoint doesn't hit it
  cursor.style.display = "none";
  ripple.style.display = "none";
  const target = document.elementFromPoint(x, y);
  cursor.style.display = "";
  ripple.style.display = "";

  if (!target) return;

  // Dispatch synthetic mouse events in the correct order
  const eventInit: MouseEventInit = {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    view: window,
  };

  target.dispatchEvent(new MouseEvent("mouseover", eventInit));
  target.dispatchEvent(new MouseEvent("mouseenter", { ...eventInit, bubbles: false }));
  target.dispatchEvent(new MouseEvent("mousemove", eventInit));
  target.dispatchEvent(new MouseEvent("mousedown", { ...eventInit, button: 0 }));
  target.dispatchEvent(new MouseEvent("mouseup", { ...eventInit, button: 0 }));
  target.dispatchEvent(new MouseEvent("click", { ...eventInit, button: 0 }));

  // Also try focus + click for interactive elements
  if (target instanceof HTMLElement) {
    target.focus();
    // For links and buttons, also try the native click
    if (
      target instanceof HTMLAnchorElement ||
      target instanceof HTMLButtonElement ||
      target instanceof HTMLInputElement
    ) {
      target.click();
    }
  }

  console.log("[GazeControl] Click dispatched at", x, y, "on", target.tagName);
}

console.log("[GazeControl] Content script loaded");
