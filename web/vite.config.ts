import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy API + dev assets to the Go backend on :8080. The frontend
// served by Vite still lives at :5173 — same-origin via the proxy keeps CSP
// strict and avoids a CORS dance.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:8080",
      "/_dev": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split heavy vendor libs into their own chunks so they cache
        // independently of app code. CodeMirror is the heaviest by far —
        // pulling it out keeps the initial paint chunk small.
        manualChunks: {
          react: ["react", "react-dom"],
          codemirror: [
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/commands",
            "@codemirror/language",
            "@codemirror/search",
            "@codemirror/lang-javascript",
            "@codemirror/lang-python",
            "@codemirror/lang-json",
            "@codemirror/lang-markdown",
            "@codemirror/lang-rust",
            "@codemirror/lang-go",
            "@codemirror/lang-sql",
            "@codemirror/lang-yaml",
          ],
          markdown: ["markdown-it"],
          qrcode: ["qrcode"],
        },
      },
    },
  },
});
