import { defineConfig } from "vite";
// import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@components": path.resolve(__dirname, "src/components"),
      "@assets": path.resolve(__dirname, "src/assets"),
      "@api": path.resolve(__dirname, "src/api"),
      "@lib": path.resolve(__dirname, "src/lib"),
      "@pages": path.resolve(__dirname, "src/pages"),
      "@types": path.resolve(__dirname, "src/types"),
      "@hooks": path.resolve(__dirname, "src/hooks"),
      "@store": path.resolve(__dirname, "src/store"),
    },
  },
  server: {
    proxy: {
      "/realms": {
        target: "http://localhost:7080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/realms/, ""),
      },
      "/api/v1/admin": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/v1\/admin/, "/api/v1"),
      },
      "/api/v1/config": {
        target: "http://localhost:3002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/v1\/config/, "/api/v1"),
      },
      "/api/v1/jobs": {
        target: "http://localhost:3006",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/v1\/jobs/, "/api/v1"),
      },
      "/api/v1/workers": {
        target: "http://localhost:3006",
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/api\/v1\/workers/, "/api/v1/workers"),
      },
      "/api/v1/report": {
        target: "http://localhost:3003",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/v1\/report/, "/api/v1/report"),
      },
    },
  },
});
