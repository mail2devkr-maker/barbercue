import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/pr168",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 12_000 },
  use: {
    baseURL: process.env.PR168_WEB_URL ?? "http://127.0.0.1:30168",
    browserName: "chromium",
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 25_000,
  },
});
