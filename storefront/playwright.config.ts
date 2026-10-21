import { defineConfig, devices } from "@playwright/test";

/**
 * Two suites, one runner:
 *   api  plain HTTP against the games (:4101-4104) and the platform (:4000)
 *   ui   a real browser against the storefront (:3000)
 *
 * Both depend on `preflight`, which fails fast when the stack is not running
 * instead of letting every test fail with a connection error.
 *
 * Every service keeps its state in memory and the tests share it, so they run
 * one at a time and measure before/after differences rather than absolute
 * values. Restart the stack for a clean slate.
 */
export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/results.json" }],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: process.env.STOREFRONT_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "preflight",
      testDir: "./tests",
      testMatch: /preflight\.setup\.ts/,
    },
    {
      name: "api",
      testDir: "./tests/api",
      dependencies: ["preflight"],
    },
    {
      name: "ui",
      testDir: "./tests/e2e",
      dependencies: ["preflight"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
