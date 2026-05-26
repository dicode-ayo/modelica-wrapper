/**
 * Completion e2e — exercises the autocomplete provider end-to-end.
 *
 * What this depends on (introduced by `feat/lang-99-autocomplete`):
 *   - `ModelicaCompletionProvider` registered for the `modelica` language,
 *     with `.` as a trigger character.
 *   - The pure routing core (`computeCompletions`) sourcing candidates from
 *     `getClassNames` / `searchClassNames` / `getComponents` / `getParameterNames`
 *     depending on the cursor context.
 *
 * Member-access and modifier-name candidates flow through OMC (the
 * `qualifyPath` + `walkCrefType` path that resolves a cref's type to its
 * members). So this spec **requires `omc` on `$PATH` and a populated
 * MODELICAPATH** to be meaningful — it's **skipped by default** and runs only
 * with `E2E_OMC=1`:
 *
 *   E2E_OMC=1 pnpm --filter modelica-wrapper test:e2e
 *
 * The class-name source (type / `extends` positions) is OMC-backed too via
 * `searchClassNames`, so even the simpler test below is gated.
 */

import { expect, test } from "../test-base.js";
import { openFileViaQuickOpen, waitForWorkbench } from "../helpers.js";

const omcEnabled = process.env["E2E_OMC"] === "1";

test.describe(
  omcEnabled ? "Completion (OMC-backed)" : "Completion (skipped — set E2E_OMC=1)",
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

      // Click into the editor — the second `R` in `v = R * i;` — then move to
      // end-of-token and type `.` to trigger member-access completion.
      const rInEquation = page
        .locator(".monaco-editor .view-lines span[class*='mtk']")
        .filter({ hasText: /^R$/ })
        .nth(1);
      await rInEquation.click();
      await page.keyboard.press("End");
      // Backspace twice to drop ` *` so we don't leave the file syntactically
      // broken when we type the dot. Then type the trigger.
      await page.keyboard.press("ArrowRight"); // past R
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
  },
);
