/**
 * Shared Playwright helpers for the code-server-driven e2e suite.
 *
 * The harness boots one code-server (via `global-setup.ts`) and stashes its URL
 * in `process.env.E2E_CODE_SERVER_URL`. Every spec navigates to that URL and
 * drives the workbench. Future feature PRs add their own `*.spec.ts` files and
 * reuse the helpers below rather than re-rolling timeouts and selectors.
 */

import { expect, type Page } from "@playwright/test";

/** Generous first-boot timeout: code-server compiles workbench assets on demand. */
export const WORKBENCH_TIMEOUT_MS = 60_000;

/** Resolve the code-server URL the global-setup hook published. */
export function workbenchUrl(): string {
  const url = process.env["E2E_CODE_SERVER_URL"];
  if (!url) {
    throw new Error("E2E_CODE_SERVER_URL is not set — global setup didn't run");
  }
  return url;
}

/**
 * Wait for the Monaco workbench shell to attach. Use this once per test before
 * any other workbench interaction.
 */
export async function waitForWorkbench(page: Page): Promise<void> {
  await page.locator(".monaco-workbench").first().waitFor({
    state: "attached",
    timeout: WORKBENCH_TIMEOUT_MS,
  });
}

/**
 * Open a file in the workspace by name, via Quick Open (`Ctrl+P` → type → Enter).
 *
 * Quick Open's input takes a tick to focus after the keybinding, and the result
 * list takes a tick to populate after typing — wait on both before pressing
 * Enter, otherwise the keystroke can hit a stale selection.
 *
 * Resolves once the editor's `.view-lines` becomes visible (a reliable signal
 * that the chosen file is now the active editor).
 */
export async function openFileViaQuickOpen(
  page: Page,
  filename: string,
): Promise<void> {
  await page.keyboard.press("Control+P");
  await page.locator(".quick-input-widget").waitFor({ state: "visible" });
  await page.keyboard.type(filename);
  await page
    .locator(".quick-input-widget .monaco-list-row")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.press("Enter");
  await page.locator(".monaco-editor .view-lines").first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

/**
 * Run a command from the Command Palette by its visible title (e.g.
 * `Outline: Focus on Outline View`). The wait/Enter sequence mirrors
 * {@link openFileViaQuickOpen} so it stays robust under first-boot latency.
 */
export async function runCommandPaletteCommand(
  page: Page,
  commandTitle: string,
): Promise<void> {
  await page.keyboard.press("Control+Shift+P");
  await page.locator(".quick-input-widget").waitFor({ state: "visible" });
  await page.keyboard.type(commandTitle);
  await page
    .locator(".quick-input-widget .monaco-list-row")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
  await page.keyboard.press("Enter");
}

/**
 * Convenience re-export so specs can do
 * `import { expect, waitForWorkbench, … } from "../helpers"`.
 */
export { expect };
