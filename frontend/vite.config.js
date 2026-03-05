import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 800
  },
  server: {
    host: true,
    port: 5173,
    // When the dev server is reached via a hostname other than localhost (e.g. OpenShift Route, reverse proxy),
    // set VITE_ALLOWED_HOSTS to that hostname so Vite accepts the request. Unset = default behavior only.
    ...(process.env.VITE_ALLOWED_HOSTS && {
      allowedHosts: process.env.VITE_ALLOWED_HOSTS.split(",").map((h) => h.trim()).filter(Boolean)
    })
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.js"],
    include: ["src/**/*.{test,spec}.{js,jsx}", "tests/**/*.{test,spec}.{js,jsx}"]
  }
});
