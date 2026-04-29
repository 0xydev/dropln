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
  },
});
