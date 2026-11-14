import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const strip = (target: string, prefix: string) => ({
  target,
  changeOrigin: true,
  rewrite: (p: string) => p.replace(new RegExp(`^${prefix}`), ""),
});

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // /api keeps its prefix (gate routes live under /api); keep Host as localhost:5173 so the session cookie sticks.
      "/api": { target: "http://localhost:3000" },
      "/bank": strip("http://localhost:4001", "/bank"),
      "/fintech": strip("http://localhost:4002", "/fintech"),
    },
  },
});
