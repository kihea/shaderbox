import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/shaderbox/",
  plugins: [react()],
  server: { port: 5173 },
  // Monaco's editor core is inherently large; it's bundled on purpose so the
  // tool works fully offline. Silence the size warning for that one chunk.
  build: { chunkSizeWarningLimit: 3000 },
});
