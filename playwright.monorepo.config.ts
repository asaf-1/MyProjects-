import baseConfig from './playwright.config';
import { defineConfig } from '@playwright/test';

const existingIgnore = Array.isArray((baseConfig as any).testIgnore)
  ? (baseConfig as any).testIgnore
  : ((baseConfig as any).testIgnore ? [(baseConfig as any).testIgnore] : []);

export default defineConfig({
  ...(baseConfig as any),
  testIgnore: [
    ...existingIgnore,
    'tests/SCAPPER PROJECT/**'
  ]
});
