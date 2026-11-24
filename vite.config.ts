import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = process.env.VITE_API_PROXY ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev the web app talks to the API through Vite, so cookies stay same-origin.
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/media": { target: API, changeOrigin: true },
    },
  },
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks: { react: ["react", "react-dom", "react-router-dom"] },
      },
    },
  },
});
