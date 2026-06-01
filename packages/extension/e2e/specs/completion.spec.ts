/**
 * Completion e2e — exercises the autocomplete provider end-to-end.
 *
 * Candidates flow through OMC (the `qualifyPath` + `walkCrefType` path that
 * resolves a cref's type to its members, and the `getClassNames` /
 * `searchClassNames` class-name sources), so the provider needs `omc` to launch.
 * The suite is **skipped unless `E2E_OMC=1`**:
 *
 *   E2E_OMC=1 pnpm --filter modelica-wrapper test:e2e
 *
 * The inheritance fixture (`InheritDemo.mo`) is self-contained — a local
 * `extends` — so it does not depend on a populated MODELICAPATH.
 */

import { expect, test } from "../test-base.js";
import { openFileViaQuickOpen, waitForWorkbench } from "../helpers.js";

const omcEnabled = process.env["E2E_OMC"] === "1";

test.describe(
  omcEnabled
    ? "Completion (OMC-backed)"
    : "Completion (skipped — set E2E_OMC=1)",
  () => {
    test.skip(!omcEnabled, "OMC-dependent — set E2E_OMC=1 to enable");

    test("typing a dot inside a cref triggers the completion list", async ({
      page,
      codeServer,
    }) => {
      test.setTimeout(120_000);

      await page.goto(codeServer.url);
      await waitForWorkbench(page);
      await openFileViaQuickOpen(page, "Demo.mo");

      // Click on the second `R` in `v = R * i;`, then trim back the tail of
      // the line (` * i;`) so we type the `.` immediately after the `R` token
      // — exercises the bare-dot member-access trigger on a known identifier
      // without leaving the file syntactically broken.
      const rInEquation = page
        .locator(".monaco-editor .view-lines span[class*='mtk']")
        .filter({ hasText: /^R$/ })
        .nth(1);
      await rInEquation.click();
      await page.keyboard.press("End");
      // ` * i;` is five characters: drop them so the caret sits just past `R`.
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Backspace");
      }
      await page.keyboard.type(".");

      // The completion widget renders as `.monaco-list` under
      // `.suggest-widget`. We don't pin specific member names (those depend on
      // OMC's view of `Real`'s components in the current MSL) — just assert
      // the widget appears with at least one row.
      const suggestRow = page
        .locator(".suggest-widget.visible .monaco-list-row")
        .first();
      await expect(suggestRow).toBeVisible({ timeout: 60_000 });
    });

    test("member completion includes inherited members", async ({
      page,
      codeServer,
    }) => {
      test.setTimeout(120_000);

      await page.goto(codeServer.url);
      await waitForWorkbench(page);
      await openFileViaQuickOpen(page, "InheritDemo.mo");

      // `d` is a `Derived`, which `extends Base`. Type `d.` in the equation
      // section and require the inherited `inheritedField` in the list — a bare
      // getComponents(Derived) returns only `ownField`, so its presence proves
      // the extends-chain walk.
      const equationKeyword = page
        .locator(".monaco-editor .view-lines span[class*='mtk']")
        .filter({ hasText: /^equation$/ })
        .first();
      await equationKeyword.click();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("  d.");

      const inheritedRow = page
        .locator(".suggest-widget.visible .monaco-list-row")
        .filter({ hasText: "inheritedField" });
      await expect(inheritedRow).toBeVisible({ timeout: 60_000 });
    });
  },
);
