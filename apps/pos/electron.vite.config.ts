import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      // The money package exports TypeScript source, which plain Node cannot run, so the build bundles it. The installer
      // carries no node_modules (electron-builder.yml), so exceljs, which writes the purchase order sheet, is bundled too.
      externalizeDeps: { exclude: ['@pos-saas/money', 'exceljs'] },
    },
  },
  preload: {
    build: {
      rolldownOptions: {
        // A sandboxed preload script cannot be an ES module.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
