/**
 * Language-foundation e2e — proves the `modelica` language id + the contributed
 * TextMate grammar reach the workbench end-to-end.
 *
 * What this depends on (introduced by `feat/lang-95-foundation`):
 *   - `contributes.languages` with id `modelica` and `.mo` extension.
 *   - `contributes.grammars` pointing at `syntaxes/modelica.tmLanguage.json`.
 *   - `language-configuration.json` (brackets, comments, indentation).
 *
 * These are all **declarative** — the extension's Node host doesn't even need
 * to activate for highlighting to apply. So this spec is intentionally
 * OMC-free and runs on every PR's e2e job.
 */

import { expect, test } from "../test-base.js";
import { openFileViaQuickOpen, waitForWorkbench } from "../helpers.js";

test.describe("Language foundation (declarative, no OMC required)", () => {
  test("`.mo` file is recognized as Modelica and the TextMate grammar tokenizes keywords", async ({
    page,
    codeServer,
  }) => {
    test.setTimeout(120_000);

    await page.goto(codeServer.url);
    await waitForWorkbench(page);
    await openFileViaQuickOpen(page, "Demo.mo");

    // Editor tab confirms the file is the active editor.
    await expect(
      page.locator('.tab[aria-label*="Demo.mo" i]').first(),
    ).toBeVisible({ timeout: 30_000 });

    // ----- Language association = Modelica -----
    // The status bar contains "Modelica" once the file's languageId resolves
    // via the contributed `.mo` extension. The exact item id varies across
    // code-server / VSCode versions, so we don't pin it.
    const statusBar = page
      .locator(".statusbar, [role=status][aria-label*=Status i]")
      .first();
    await expect(statusBar).toContainText(/Modelica/i, { timeout: 30_000 });

    // ----- TextMate grammar tokenized the `model` keyword -----
    // Find an `.mtk*` token span inside `.view-lines` whose text is exactly
    // `model`. This proves both the contributed `language` id AND the
    // contributed `grammar` flowed through end-to-end.
    const tokenizedModelKeyword = page
      .locator(".monaco-editor .view-lines span[class*='mtk']")
      .filter({ hasText: /^model$/ })
      .first();
    await expect(tokenizedModelKeyword).toBeVisible({ timeout: 30_000 });
  });
});
