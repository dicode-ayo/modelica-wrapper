/**
 * Storybook-driven Playwright harness for the `<om-*>` web components.
 *
 * Real-browser coverage for interactions happy-dom can't run: Lit `@event`
 * listeners on custom elements don't fire there, and the Babylon canvas pointer
 * path needs a real renderer (see the F3 context-menu wiring). Each spec loads a
 * Storybook story iframe and drives it.
 *
 * `webServer` boots Storybook (port 6007) and reuses an already-running one
 * locally; CI starts its own.
 */

import { defineConfig, devices } from "@playwright/test";

const PORT = 6007;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env["CI"] ? 1 : "50%",
  retries: process.env["CI"] ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm start",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
  },
});
