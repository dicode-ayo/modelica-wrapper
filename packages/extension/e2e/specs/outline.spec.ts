/**
 * Outline / document-symbols e2e — the strongest OMC-free signal in the suite.
 *
 * What this depends on (introduced by `feat/lang-98-outline`):
 *   - `ModelicaDocumentSymbolProvider`, which walks the parsed tree alone (no
 *     OMC) to produce class + member symbols.
 *
 * Why it's the strongest signal: passing requires (1) the extension to
 * **activate** in the Node host, (2) the bundled `tree-sitter*.wasm` files to
 * load successfully, (3) the buffer to be parsed, and (4) the symbol provider
 * to register against the `modelica` language id. If any of those breaks, the
 * Outline pane stays empty. And it needs no `omc` — runs unconditionally.
 */

import { expect, test } from "../test-base.js";
import {
  openFileViaQuickOpen,
  runCommandPaletteCommand,
  waitForWorkbench,
} from "../helpers.js";

test.describe("Document symbols / Outline (OMC-free)", () => {
  test("Outline lists `Demo` and its parameter `R`", async ({
    page,
    codeServer,
  }) => {
    test.setTimeout(120_000);

    await page.goto(codeServer.url);
    await waitForWorkbench(page);
    await openFileViaQuickOpen(page, "Demo.mo");

    // Focus the Outline view via the command palette. The exact command id is
    // `outline.focus`; the visible title is "Outline: Focus on Outline View".
    await runCommandPaletteCommand(page, "Outline: Focus on Outline View");

    // The outline pane renders under an aria-labelled region; wait for it
    // before scanning the tree contents.
    const outlinePane = page.locator(
      '[aria-label="Outline Section" i], [aria-label*="Outline" i]',
    );
    await outlinePane.first().waitFor({ state: "visible", timeout: 30_000 });

    // Symbol activation can lag the outline view appearing — first parse pays
    // the tree-sitter WASM load + initial document parse. Poll the tree for
    // the `Demo` class entry.
    const demoSymbol = page
      .locator(".outline-tree .monaco-list-row")
      .filter({ hasText: /^Demo/ })
      .first();
    await expect(demoSymbol).toBeVisible({ timeout: 60_000 });

    // The parameter `R` is the first child the symbol walk emits for
    // `Demo`. Asserting it appears confirms the provider descended into the
    // class's members, not just listed the top-level class.
    const childR = page
      .locator(".outline-tree .monaco-list-row")
      .filter({ hasText: /^R$/ })
      .first();
    await expect(childR).toBeVisible({ timeout: 30_000 });
  });
});
