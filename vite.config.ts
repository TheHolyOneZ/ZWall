import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,

  server: { port: 1420, strictPort: true, host: "127.0.0.1", watch: { ignored: ["**/target/**", "**/src-tauri/**"] } },
  envPrefix: ["VITE_", "TAURI_"],

  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: "es2022", sourcemap: false },
});
