import { defineConfig } from "vite";

export default defineConfig({
  plugins: [],
  build: {
    minify: false,
    sourcemap: false,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:5180",
    },
  },
});
