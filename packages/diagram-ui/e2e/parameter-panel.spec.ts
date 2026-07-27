/**
 * Real-browser coverage for the floating parameter panel: a non-modal card
 * stacked under the toolbar, so the canvas underneath keeps taking pointer
 * events and only the explicit close affordances dismiss it. happy-dom can't
 * host it at all — the form's actions are form-associated `wa-button`s that
 * crash it on connect.
 */

import { test, expect } from "@playwright/test";

import { boxOf, waitForLayout } from "./story-helpers.js";

const PANEL_STORY =
  "/iframe.html?id=diagram-ui-parameterpanel--simulate&viewMode=story";
const OVERFLOWING_STORY =
  "/iframe.html?id=diagram-ui-parameterpanel--overflowing&viewMode=story";
const WORKBENCH_STORY =
  "/iframe.html?id=diagram-ui-diagramworkbench--default&viewMode=story";

/** The rail's inset on every edge (`--om-action-panel-offset`). */
const RAIL_INSET = 8;

const CARD = "om-parameter-panel .card";
const OPEN_PARAMS = 'om-action-panel wa-button[title="Edit parameters"]';

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

test.describe("a model taller than the rail", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(OVERFLOWING_STORY, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Open parameter panel" }).click();
    await expect(page.locator(CARD)).toBeVisible();
  });

  test("grows to the bottom of the rail, keeping the rail's inset", async ({
    page,
  }) => {
    const host = await boxOf(page, ".om-story-canvas-host");
    const panel = await boxOf(page, "om-parameter-panel");

    const gap = host.y + host.height - (panel.y + panel.height);
    expect(gap).toBeGreaterThanOrEqual(RAIL_INSET - 1);
    expect(gap).toBeLessThanOrEqual(RAIL_INSET + 1);
  });

  test("scrolls its body rather than overflowing the card", async ({
    page,
  }) => {
    const overflow = await page.evaluate(() => {
      const body = document
        .querySelector("om-parameter-panel")
        ?.shadowRoot?.querySelector(".body");
      if (!body) throw new Error("no panel body");
      return { scroll: body.scrollHeight, client: body.clientHeight };
    });

    expect(overflow.scroll).toBeGreaterThan(overflow.client);
  });
});

test.describe("stacked with the toolbar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(WORKBENCH_STORY, { waitUntil: "networkidle" });
    await waitForLayout(page);
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

    // Nothing overlays the canvas, so the click lands on it and the panel is
    // untouched.
    await expect(page.locator(CARD)).toBeVisible();
  });

  test("still closes on Escape after the canvas takes focus", async ({
    page,
  }) => {
    // The panel owns Escape wherever focus sits. Bound to the card alone it
    // went dead here, and the diagram's own Escape binding swallowed the key.
    const canvas = await boxOf(page, "om-graphical-layout");
    await page.mouse.click(canvas.x + 20, canvas.y + canvas.height - 20);

    await page.keyboard.press("Escape");

    await expect(page.locator(CARD)).toHaveCount(0);
  });
});
