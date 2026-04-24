import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const viteAllowedHosts = () => {
  const raw = process.env.VITE_ALLOWED_HOSTS;
  if (typeof raw !== "string") return null;
  const list = raw
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return list.length ? list : null;
};

const allowedHosts = viteAllowedHosts();

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 800
  },
  server: {
    host: true,
    port: 5173,
    // When the dev server is reached via a hostname other than localhost (e.g. reverse proxy),
    // set VITE_ALLOWED_HOSTS (see docker-compose.yml / compose.override.yml). Unset or empty = Vite defaults.
    ...(allowedHosts ? { allowedHosts } : {})
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.js"],
    include: ["src/**/*.{test,spec}.{js,jsx}", "tests/**/*.{test,spec}.{js,jsx}"]
  }
});
