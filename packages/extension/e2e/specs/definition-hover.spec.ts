/**
 * Definition + hover e2e — exercises the OMC-backed half of the language stack.
 *
 * What this depends on (introduced by `feat/lang-97-defhover`):
 *   - `ModelicaDefinitionProvider` (go-to-def via `qualifyPath` +
 *     `getClassInformation`).
 *   - `ModelicaHoverProvider` (entity restriction + doc-comment rendering).
 *
 * Both providers resolve names through a live OMC instance, so this spec
 * **requires `omc` on `$PATH` and a populated MODELICAPATH** to be meaningful.
 * It is **skipped by default** and runs only with `E2E_OMC=1` — keep CI fast
 * and flake-free. Run locally with:
 *
 *   E2E_OMC=1 pnpm --filter modelica-wrapper test:e2e
 *
 * The fixture `Demo.mo` declares `parameter Real R = 1.0 "Resistance";`, so
 * the hover on `R` in the equation `v = R * i;` should surface the doc
 * string "Resistance" once OMC has resolved the cref to its declaration.
 */

import { expect, test } from "../test-base.js";
import { openFileViaQuickOpen, waitForWorkbench } from "../helpers.js";

const omcEnabled = process.env["E2E_OMC"] === "1";

test.describe(
  omcEnabled ? "Definition + hover (OMC-backed)" : "Definition + hover (skipped — set E2E_OMC=1)",
  () => {
    test.skip(!omcEnabled, "OMC-dependent — set E2E_OMC=1 to enable");

    test("hover on `R` in the equation surfaces its doc string", async ({
      page,
      codeServer,
    }) => {
      test.setTimeout(120_000);

      await page.goto(codeServer.url);
      await waitForWorkbench(page);
      await openFileViaQuickOpen(page, "Demo.mo");

      // The second occurrence of `R` is the component-reference in the
      // equation `v = R * i;` — the path the hover provider's main flow takes
      // (cref → qualify → getClassInformation / getClassComment).
      const rInEquation = page
        .locator(".monaco-editor .view-lines span[class*='mtk']")
        .filter({ hasText: /^R$/ })
        .nth(1);
      await rInEquation.hover();

      const hover = page.locator(".monaco-hover").first();
      // The doc string from `parameter Real R = 1.0 "Resistance"` should appear
      // in the rendered markdown. Generous timeout — first hover after open
      // pays the OMC `loadFile` + `qualifyPath` round-trip cost.
      await expect(hover).toContainText(/Resistance/i, { timeout: 60_000 });
    });

    test("go-to-definition on the `Real` type navigates", async ({
      page,
      codeServer,
    }) => {
      test.setTimeout(120_000);

      await page.goto(codeServer.url);
      await waitForWorkbench(page);
      await openFileViaQuickOpen(page, "Demo.mo");

      // Press F12 on the `Real` keyword. We don't pin the exact target
      // location (varies across MSL versions) — just assert that VSCode
      // navigates somewhere, signalled by a NEW editor tab appearing.
      const realType = page
        .locator(".monaco-editor .view-lines span[class*='mtk']")
        .filter({ hasText: /^Real$/ })
        .first();
      await realType.click();
      await page.keyboard.press("F12");

      // A second editor tab opens for the definition target, or focus moves to
      // another `.mo` source. Either way, an editor tab labelled with a `.mo`
      // file other than `Demo.mo` becomes visible.
      const otherMoTab = page
        .locator('.tab[aria-label*=".mo" i]')
        .filter({ hasNotText: "Demo.mo" })
        .first();
      await expect(otherMoTab).toBeVisible({ timeout: 60_000 });
    });
  },
);
