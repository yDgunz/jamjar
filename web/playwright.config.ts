import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration for JamJar.
 *
 * Expects the dev servers (API on :8000, frontend on :5173) to be running
 * with seeded test data (see scripts/seed-db.py).
 *
 * Override the base URL via the PLAYWRIGHT_BASE_URL env var:
 *   PLAYWRIGHT_BASE_URL=https://my-branch.jam-jar.app npx playwright test
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // tests share auth state, run serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    colorScheme: "dark",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
