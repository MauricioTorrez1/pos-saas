import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // Logic runs in Node. Component tests opt into jsdom with a `@vitest-environment` comment.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
