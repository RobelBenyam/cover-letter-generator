import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const dir = path.dirname(fileURLToPath(import.meta.url));
const coverLetterRoot = path.join(dir, "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, coverLetterRoot, "");
  const apiPort = env.COVER_LETTER_PORT || "3847";

  return {
    root: dir,
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
