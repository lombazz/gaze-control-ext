import { defineConfig } from "vite";
import { resolve } from "path";
import { cpSync, mkdirSync } from "fs";

// Plugin to copy static assets (HTML, CSS, icons) to dist
function copyStaticAssets() {
  return {
    name: "copy-static-assets",
    closeBundle() {
      // Copy HTML files to dist
      const htmlFiles = [
        ["src/offscreen/offscreen.html", "dist/offscreen/offscreen.html"],
        ["src/popup/popup.html", "dist/popup/popup.html"],
        ["src/calibration/calibration.html", "dist/calibration/calibration.html"],
      ];
      for (const [src, dest] of htmlFiles) {
        cpSync(src, dest, { force: true });
      }
      // Copy CSS
      cpSync("src/content/cursor-overlay.css", "dist/content/cursor-overlay.css", {
        force: true,
      });
      // Copy icons
      try {
        mkdirSync("dist/assets/icons", { recursive: true });
        cpSync("assets/icons", "dist/assets/icons", { recursive: true, force: true });
      } catch {}
      // Copy MediaPipe WASM + models
      try {
        mkdirSync("dist/mediapipe/wasm", { recursive: true });
        mkdirSync("dist/mediapipe/models", { recursive: true });
        cpSync("assets/mediapipe/wasm", "dist/mediapipe/wasm", { recursive: true, force: true });
        cpSync("assets/mediapipe/models", "dist/mediapipe/models", { recursive: true, force: true });
      } catch {}
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "background/service-worker": resolve(
          __dirname,
          "src/background/service-worker.ts"
        ),
        "offscreen/offscreen": resolve(
          __dirname,
          "src/offscreen/offscreen.ts"
        ),
        "content/content-script": resolve(
          __dirname,
          "src/content/content-script.ts"
        ),
        "popup/popup": resolve(__dirname, "src/popup/popup.ts"),
        "calibration/calibration": resolve(
          __dirname,
          "src/calibration/calibration.ts"
        ),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "[name].[ext]",
      },
    },
    sourcemap: true,
    target: "esnext",
    minify: false,
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  plugins: [copyStaticAssets()],
});
