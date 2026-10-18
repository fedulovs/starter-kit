import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.STOREFRONT_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
