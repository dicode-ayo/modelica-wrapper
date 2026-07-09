/**
 * Baseline e2e smoke test — proves the extension installs into code-server
 * and its declarative contributions reach the workbench.
 *
 * Intentionally scoped to what `main` provides today (no language features):
 *
 *   - A. The Monaco workbench mounts.
 *   - B. The Modelica activity-bar item is registered (`contributes.viewsContainers`).
 *   - C. Opening it reveals the Libraries view, whose webview renders — which
 *        proves the views contribution and that the extension activates and
 *        resolves the view provider on demand. The empty-state text
 *        ("No Modelica libraries are loaded yet.") lives inside that webview
 *        iframe, so this asserts the iframe rather than reaching into it.
 *
 * Feature PRs (`feat/lang-*`) layer their own `*.spec.ts` files alongside this
 * one and assert their own behavior (highlighting, outline, hover, completion,
 * …) on top of the same harness.
 */

import { expect, test } from "../test-base.js";
import { waitForWorkbench } from "../helpers.js";

test.describe("Extension loads (baseline, no language features)", () => {
  test("workbench mounts, Modelica activity-bar item appears, Libraries webview renders", async ({
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

    // ----- C. The Libraries view opens and its webview renders -----
    // Clicking the activity-bar item reveals the sidebar containing the
    // `modelica.libraries` view. It's a webview view (a WebviewViewProvider),
    // so its content — including the empty-state — lives inside a webview
    // iframe; the iframe appearing proves the provider resolved (the extension
    // activated on the `onView` event).
    await modelicaActivity.click();
    await expect(page.locator("iframe.webview").first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
