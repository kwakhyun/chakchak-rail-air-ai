import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: "http://127.0.0.1:4184",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } }
    }
  ],
  webServer: {
    command: "npm run dev",
    env: { PORT: "4184", OPENAI_API_KEY: "", DATA_GO_KR_API_KEY: "", TOUR_API_KEY: "", CHAKCHAK_VALIDATION_STORE: "/tmp/chakchak-e2e-validation.json", CHAKCHAK_VALIDATION_SECRET: "test-only-secret", CHAKCHAK_PILOT_ADMIN_KEY: "test-only-admin" },
    url: "http://127.0.0.1:4184/api/health",
    reuseExistingServer: false,
    timeout: 30_000
  }
});
