/**
 * Worker-scoped Playwright test base.
 *
 * Each Playwright worker (one Node process per `workers` count) gets its OWN
 * code-server child — random port, isolated `--user-data-dir` and
 * `--extensions-dir`. That isolation is what makes `workers > 1` safe: specs in
 * different workers can no longer trample each other's workbench state. With a
 * single shared code-server (the previous global-setup design), bumping workers
 * would have leaked tab/view state across specs.
 *
 * The `codeServer` fixture is `scope: "worker"`, so code-server boots **once
 * per worker** and is reused across every test that worker runs. It's disposed
 * when the worker shuts down — killing only the exact spawned PID. There is no
 * `pkill code-server` anywhere; the IDE this is developed in may itself be a
 * code-server window.
 */

import { test as base } from "@playwright/test";

import {
  startCodeServer,
  type CodeServerHandle,
} from "./code-server-harness.js";

interface WorkerFixtures {
  /** A live code-server scoped to this worker; reused across the worker's tests. */
  codeServer: CodeServerHandle;
}

// `{}` is the Playwright-idiomatic spelling for "no test-scoped fixtures";
// using `Record<string, never>` collapses the worker fixtures via its index
// signature, so the worker `codeServer` ends up typed `never` to callers.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const test = base.extend<{}, WorkerFixtures>({
  codeServer: [
    async ({}, use, workerInfo) => {
      const handle = await startCodeServer();
      console.log(
        `[e2e] worker ${workerInfo.workerIndex} code-server up on ${handle.url} ` +
          `(pid=${handle.pid}, log=${handle.logFile})`,
      );
      try {
        await use(handle);
      } finally {
        await handle.stop();
        console.log(
          `[e2e] worker ${workerInfo.workerIndex} code-server (pid=${handle.pid}) stopped`,
        );
      }
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
