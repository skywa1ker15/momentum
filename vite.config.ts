import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  optimizeDeps: { exclude: ["@babylonjs/havok"] },
  build: {
    target: "es2022",
    // One main chunk of about 1.7 MB (0.4 MB gzipped): Babylon tree-shakes best when left to Rollup.
    // Splitting it by hand was tried and nearly doubled the download, so the limit just sits above today's size.
    chunkSizeWarningLimit: 1800,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
  },
});
