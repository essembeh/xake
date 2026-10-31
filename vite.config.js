import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  // Relative URLs: the same build serves from the root (Docker) and from /xake/ (GitHub Pages)
  base: "./",
  // Set by npm for its scripts: the version of package.json
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version) },
  server: { host: true, port: 8000, strictPort: true },
  preview: { host: true, port: 8000, strictPort: true },
  // Pre-bundling would break the import.meta.url lookup of ONNX Runtime's wasm
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  build: { chunkSizeWarningLimit: 1024 },
  plugins: [
    // The Stockfish worker loads its wasm next to itself: both stay unbundled (spec 005 §2)
    viteStaticCopy({
      targets: [
        {
          src: [
            "node_modules/stockfish/bin/stockfish-19-lite-single.js",
            "node_modules/stockfish/bin/stockfish-19-lite-single.wasm",
            "node_modules/stockfish/Copying.txt",
          ],
          dest: "stockfish",
          rename: { stripBase: true },
        },
      ],
    }),
  ],
});
