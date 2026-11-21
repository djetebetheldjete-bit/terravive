import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Le proxy /api évite les soucis CORS en développement.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
