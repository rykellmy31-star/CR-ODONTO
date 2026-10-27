import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: o Vite serve o SPA e encaminha /api e /uploads ao Worker (wrangler dev).
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Aceita o host de preview do ambiente de desenvolvimento (subdomínio dinâmico).
    allowedHosts: true,
    proxy: {
      // changeOrigin: false mantém o Host original, para que a checagem de
      // mesma origem (Origin === Host) do Worker continue válida no dev.
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: false },
      "/uploads": { target: "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
