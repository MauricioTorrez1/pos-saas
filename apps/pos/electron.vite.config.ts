import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      // The money package exports TypeScript source, which plain Node cannot run, so the build bundles it.
      externalizeDeps: { exclude: ['@pos-saas/money'] },
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
