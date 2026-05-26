/**
 * Playwright config for the code-server end-to-end harness.
 *
 * Each Playwright worker gets its own code-server child via the worker-scoped
 * `codeServer` fixture in `test-base.ts` — random port, isolated `--user-data-dir`
 * and `--extensions-dir`. That makes `workers > 1` + `fullyParallel: true` safe:
 * specs in different workers never share workbench state.
 *
 * Workers cap: `process.env.CI ? 2 : "50%"`. CI runners have 2–4 cores and other
 * jobs are running concurrently, so 2 is the conservative pick. Locally we use
 * half the CPUs (Playwright's recommended idiom), which scales with the dev's
 * machine without flooding it. Each code-server is ~200 MB resident, so 4
 * parallel workers fit comfortably in a 4 GB budget.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  // First boot of code-server compiles webview assets; the workbench is the
  // bottleneck, not the assertions. Generous timeouts absorb that.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  workers: process.env["CI"] ? 2 : "50%",
  retries: 0,
  reporter: [["list"]],
  use: {
    headless: true,
    // `baseURL` is intentionally not set here — each spec reads its
    // worker-local code-server URL from the `codeServer` fixture, because the
    // URL depends on the random port each worker's harness picks.
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    // Capture more on failure for post-mortem.
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
