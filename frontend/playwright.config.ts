import { defineConfig, devices } from '@playwright/test';

// End-to-end tests in a real browser: a patient scans a bedside QR and asks
// for help, staff assign, do, and close the work, and the report counts it.
// They start their own API (port 3101) and a production build of the web app
// (port 4173, with the production security headers) against the isolated
// test database in TEST_DATABASE_URL: never the development servers, the
// development database, or the live one.
const testDatabase = process.env.TEST_DATABASE_URL;
if (!testDatabase) {
  throw new Error('Set TEST_DATABASE_URL to the isolated test database to run end-to-end tests.');
}
const api = 'http://127.0.0.1:3101';
const web = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  // One browser at a time: the tests share the hospitals made in global setup.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    ...devices['Desktop Chrome'],
    // Full Chromium (not the lighter headless shell), so the built-in PDF
    // viewer is there for the QR labels test.
    channel: 'chromium',
    baseURL: web,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node --import tsx src/server.ts',
      cwd: '../services',
      url: `${api}/ready`,
      // Never attach to a server that is already running (such as yours).
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3101',
        DATABASE_URL: testDatabase,
        PUBLIC_APP_URL: web,
        // Blank or fixed, so nothing comes from services/.env.
        REDIS_URL: '',
        CORS_ORIGINS: '',
        TRUST_PROXY: '0',
        LOG_LEVEL: 'warn',
        ESCALATION_INTERVAL_SECONDS: '0',
      },
    },
    {
      command:
        'npx vite build --outDir .e2e-dist --emptyOutDir && npx vite preview --outDir .e2e-dist --host 127.0.0.1 --port 4173 --strictPort',
      url: web,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_URL: api },
    },
  ],
});
