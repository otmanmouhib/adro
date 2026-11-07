import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  server: {
    host: true,
    proxy: { "/api/systems": "http://127.0.0.1:3001" },
  },
});
