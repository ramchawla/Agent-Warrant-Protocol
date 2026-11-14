import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const strip = (target: string, prefix: string) => ({
  target,
  changeOrigin: true,
  rewrite: (p: string) => p.replace(new RegExp(`^${prefix}`), ""),
});

// AWP_*_PORT points the proxy at a second, isolated backend stack (defaults: the demo stack).
const env = process.env;
const gate = `http://localhost:${env.AWP_GATE_PORT ?? 3000}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(env.STORY_PORT ?? 5173),
    strictPort: true,
    proxy: {
      // /api keeps its prefix (gate routes live under /api); keep Host as localhost:5173 so the session cookie sticks.
      "/api": { target: gate },
      "/bank": strip(`http://localhost:${env.AWP_BANK_PORT ?? 4001}`, "/bank"),
      "/fintech": strip(`http://localhost:${env.AWP_FINTECH_PORT ?? 4002}`, "/fintech"),
    },
  },
});
