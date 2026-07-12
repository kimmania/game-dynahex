import { defineConfig, devices } from '@playwright/test';

// Smoke tests run against the built PWA via `vite preview`.
// WebKit is the Safari engine — required so we catch iPad/Safari-only issues
// (micro-movements triggering drag detection, no hover, pointermove-only-on-touch).
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    // Simulate iPad: touch + no hover, small movements between pointerdown/up.
    hasTouch: true,
    isMobile: true,
    viewport: { width: 834, height: 1112 }, // iPad Air portrait
    actionTimeout: 5_000,
  },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'], hasTouch: true, isMobile: true, viewport: { width: 834, height: 1112 } } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
