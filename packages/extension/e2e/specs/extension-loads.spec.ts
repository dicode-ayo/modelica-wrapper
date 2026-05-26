/**
 * Baseline e2e smoke test — proves the extension installs into code-server
 * and its declarative contributions reach the workbench.
 *
 * Intentionally scoped to what `main` provides today (no language features):
 *
 *   - A. The Monaco workbench mounts.
 *   - B. The Modelica activity-bar item is registered (`contributes.viewsContainers`).
 *   - C. Opening it reveals the Libraries view with its `viewsWelcome`
 *        empty-state ("No Modelica libraries are loaded yet."), which proves
 *        both the views contribution and the extension is reachable on demand.
 *
 * Feature PRs (`feat/lang-*`) layer their own `*.spec.ts` files alongside this
 * one and assert their own behavior (highlighting, outline, hover, completion,
 * …) on top of the same harness.
 */

import { expect, test } from "../test-base.js";
import { waitForWorkbench } from "../helpers.js";

test.describe("Extension loads (baseline, no language features)", () => {
  test("workbench mounts, Modelica activity-bar item appears, Libraries welcome shows", async ({
    page,
    codeServer,
  }) => {
    test.setTimeout(120_000);

    // ----- A. Workbench mounts -----
    await page.goto(codeServer.url);
    await waitForWorkbench(page);

    // ----- B. Modelica activity-bar item is registered -----
    // The extension contributes a viewsContainer titled "Modelica" (id
    // `modelica-sidebar`). VSCode renders it as an actionable item in the
    // activity bar, accessible-labelled by the container title.
    const modelicaActivity = page
      .locator('.activitybar [aria-label*="Modelica" i]')
      .first();
    await expect(modelicaActivity).toBeVisible({ timeout: 30_000 });

    // ----- C. The Libraries view opens with its viewsWelcome empty-state -----
    // Clicking the activity-bar item reveals the sidebar containing the
    // `modelica.libraries` view. Its `viewsWelcome` text is the empty-state
    // shown when no library is loaded — always the case at startup.
    await modelicaActivity.click();
    await expect(
      page.getByText(/No Modelica libraries are loaded yet/i),
    ).toBeVisible({ timeout: 30_000 });
  });
});
