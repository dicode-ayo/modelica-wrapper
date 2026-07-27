/**
 * Real-browser coverage for the floating parameter panel: it is a non-modal
 * card stacked under the toolbar, not a drawer, so the canvas underneath keeps
 * taking pointer events and only the explicit close affordances dismiss it.
 * happy-dom can't host it at all — the form's actions are form-associated
 * `wa-button`s that crash it on connect.
 */

import { test, expect, type Page } from "@playwright/test";

const PANEL_STORY =
  "/iframe.html?id=diagram-ui-parameterpanel--simulate&viewMode=story";
const WORKBENCH_STORY =
  "/iframe.html?id=diagram-ui-diagramworkbench--default&viewMode=story";

const CARD = "om-parameter-panel .card";
const OPEN_PARAMS = 'om-action-panel wa-button[title="Edit parameters"]';

async function boxOf(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    throw new Error(`no box for ${selector}`);
  }
  return box;
}

test.describe("standalone panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PANEL_STORY, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Open parameter panel" }).click();
    await expect(page.locator(CARD)).toBeVisible();
  });

  test("closes via the header button", async ({ page }) => {
    await page.locator("om-parameter-panel .close").click();
    await expect(page.locator(CARD)).toHaveCount(0);
  });

  test("closes on Escape", async ({ page }) => {
    // Opening moves focus into the card, so Escape lands without an extra
    // click — a click would confound this with the dismiss path.
    await page.keyboard.press("Escape");
    await expect(page.locator(CARD)).toHaveCount(0);
  });

  test("stays open when the surface behind it is clicked", async ({ page }) => {
    const card = await boxOf(page, CARD);
    // Well clear of the card, which floats in the top-right corner.
    await page.mouse.click(card.x - 40, card.y + card.height + 40);

    await expect(page.locator(CARD)).toBeVisible();
  });
});

test.describe("stacked with the toolbar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(WORKBENCH_STORY, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const el = document.querySelector("om-graphical-layout") as
        | (HTMLElement & { layout?: { components?: object } })
        | null;
      return Boolean(el?.layout?.components);
    });
    await page.locator(OPEN_PARAMS).click();
    await expect(page.locator(CARD)).toBeVisible();
  });

  test("opens below the toolbar, sharing its right edge", async ({ page }) => {
    const toolbar = await boxOf(page, "om-action-panel");
    const panel = await boxOf(page, "om-parameter-panel");

    expect(panel.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
    expect(
      Math.abs(panel.x + panel.width - (toolbar.x + toolbar.width)),
    ).toBeLessThanOrEqual(1);
  });

  test("stays inside the canvas host", async ({ page }) => {
    const host = await boxOf(page, ".om-story-canvas-host");
    const panel = await boxOf(page, "om-parameter-panel");

    expect(panel.y + panel.height).toBeLessThanOrEqual(
      host.y + host.height + 1,
    );
  });

  test("leaves the canvas interactive while it is open", async ({ page }) => {
    const canvas = await boxOf(page, "om-graphical-layout");
    await page.mouse.click(canvas.x + 20, canvas.y + canvas.height - 20);

    // A drawer's backdrop would have swallowed that click and closed the panel.
    await expect(page.locator(CARD)).toBeVisible();
  });
});
