import baseConfig from './playwright.config';
import { defineConfig } from '@playwright/test';

const existingIgnore = Array.isArray((baseConfig as any).testIgnore)
  ? (baseConfig as any).testIgnore
  : ((baseConfig as any).testIgnore ? [(baseConfig as any).testIgnore] : []);

export default defineConfig({
  ...(baseConfig as any),
  projects: [
    {
      name: 'chromium',
      use: {
        ...(baseConfig as any).use,
        browserName: 'chromium',
      },
    },
  ],
  testIgnore: [
    ...existingIgnore,
    'tests/SCAPPER PROJECT/**',
    'tests/GeminiSheets.spec.ts',
    'tests/test-1.spec.ts',
  ],
});
