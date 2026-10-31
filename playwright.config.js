import { defineConfig, devices } from "@playwright/test";

// Smoke test of the built site (spec 007 §2.8). Firefox is left out: Playwright's build runs
// WebAssembly ~12x slower than a real Firefox (spec 005 §9).
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:8000/" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 900 } } },
  ],
  // localhost is a secure context: the service worker registers, as in production
  webServer: { command: "npm run build && npm run preview", url: "http://localhost:8000/", reuseExistingServer: true },
});
