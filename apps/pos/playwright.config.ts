import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  // The github reporter turns failures into annotations, readable without access to the logs.
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
});
