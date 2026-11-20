import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// The app is served under /recipes/ (like GitHub Pages) so relative URLs are
// tested on every run (N3).
export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/recipes/`,
    trace: 'off',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 1180, height: 820 } } },
  ],
  webServer: {
    command: `node tools/dev-server.mjs --port ${PORT} --base /recipes/`,
    url: `http://127.0.0.1:${PORT}/recipes/`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
  },
});
