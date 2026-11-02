/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { gzipSync } from 'node:zlib'
import { defineConfig, type Plugin } from 'vite'

/**
 * The CAD models (STEP text, ~6× smaller gzipped) are written gzipped under their own names, which keeps the
 * GitHub Pages site under its 1 GB limit. Pages sends them without Content-Encoding, so the app unpacks them itself
 * (`src/cad/stepText.ts`); the dev server serves them raw.
 */
function gzipDrawings(): Plugin {
  return {
    name: 'gzip-drawings',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle))
        if (file.type === 'asset' && /\.(stp|step)$/i.test(file.fileName)) file.source = gzipSync(file.source, { level: 9 })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), gzipDrawings()],
  // Relative asset URLs: the build works at the GitHub Pages path (/AxisPilot/) as well as at a root.
  base: './',
  // Product data (Data/*.json) is bundled on purpose; it dominates the chunk size.
  build: { chunkSizeWarningLimit: 1000 },
  // The OpenCascade tessellation worker (src/cad/occt.worker.ts) loads its WebAssembly with dynamic imports.
  worker: { format: 'es' },
  // CAD tests read and tessellate real STEP files; on the slower CI runners one took 5.04 s against the 5 s default
  test: { testTimeout: 30000 },
})
