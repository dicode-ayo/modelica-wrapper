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
 *
 * Cursor placement is keyboard-driven (`Control+Home` then `ArrowDown`) rather
 * than by clicking a token span: code-server merges adjacent same-scope
 * characters into one rendered span, so a per-identifier locator is unreliable.
 */

import { type Page } from "@playwright/test";

import { expect, test } from "../test-base.js";
import { openFileViaQuickOpen, waitForWorkbench } from "../helpers.js";

const omcEnabled = process.env["E2E_OMC"] === "1";

/** Focus the editor and place the caret at the start of `line` (1-based). */
async function goToLineStart(page: Page, line: number): Promise<void> {
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("Control+Home");
  for (let i = 1; i < line; i++) {
    await page.keyboard.press("ArrowDown");
  }
}

const suggestRow = (page: Page, label: string) =>
  page
    .locator(".suggest-widget.visible .monaco-list-row")
    .filter({ hasText: label });

test.describe(
  omcEnabled
    ? "Completion (OMC-backed)"
    : "Completion (skipped — set E2E_OMC=1)",
  () => {
    test.skip(!omcEnabled, "OMC-dependent — set E2E_OMC=1 to enable");

    test("member completion includes inherited members", async ({
      page,
      codeServer,
    }) => {
      test.setTimeout(120_000);

      await page.goto(codeServer.url);
      await waitForWorkbench(page);
      await openFileViaQuickOpen(page, "InheritDemo.mo");

      // `d` is a `Derived`, which `extends Base`. Type `d.` in the equation
      // section (line 10) and require the inherited `inheritedField` — a bare
      // getComponents(Derived) returns only `ownField`, so its presence proves
      // the extends-chain walk.
      await goToLineStart(page, 10);
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("  d.");
      await page.keyboard.press("Control+Space");

      await expect(suggestRow(page, "inheritedField")).toBeVisible({
        timeout: 60_000,
      });
    });
  },
);
