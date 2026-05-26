/**
 * Playwright config for the code-server end-to-end smoke test.
 *
 * - Headless Chromium via the cached `~/.cache/ms-playwright` browser. We
 *   deliberately don't pin to system `google-chrome` to keep the run
 *   reproducible across machines.
 * - One global setup hook boots code-server; its returned teardown function
 *   stops the spawned PID surgically.
 * - One worker, no retries: the suite is tiny and the cost is the boot, not
 *   the assertions.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  // First boot of code-server compiles webview assets; the workbench is the
  // bottleneck, not the assertions. A generous expect timeout absorbs that.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: require.resolve("./global-setup.ts"),
  use: {
    headless: true,
    // baseURL is filled per-test from process.env.E2E_CODE_SERVER_URL — we
    // can't set it here because the URL depends on the random port the
    // harness picks at setup time.
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
