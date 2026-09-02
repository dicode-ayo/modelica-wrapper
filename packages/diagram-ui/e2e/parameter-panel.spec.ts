/**
 * Real-browser coverage for the floating parameter panel: a non-modal card
 * stacked under the toolbar, so the canvas underneath keeps taking pointer
 * events and only the explicit close affordances dismiss it. happy-dom can't
 * host it at all — the form's actions are form-associated `wa-button`s that
 * crash it on connect.
 */

import { test, expect, type Page } from "@playwright/test";

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

/** Collects every `om-panel-focus` the panel dispatches from here on. */
async function recordFocusReports(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sink = window as unknown as { __focus: boolean[] };
    sink.__focus = [];
    document.addEventListener("om-panel-focus", (e) => {
      sink.__focus.push(
        (e as CustomEvent<{ focused: boolean }>).detail.focused,
      );
    });
  });
}

/** The panel's latest report, or `undefined` if it has not made one. */
async function lastFocusReport(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() =>
    (window as unknown as { __focus: boolean[] }).__focus.at(-1),
  );
}

/** Innermost focused node, descending through open shadow roots. */
async function deepActiveTag(page: Page): Promise<string> {
  return page.evaluate(() => {
    let el: Element | null = document.activeElement;
    while (el?.shadowRoot?.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el?.tagName.toLowerCase() ?? "";
  });
}

test.describe("focus reporting", () => {
  // The diagram binds bare `r`, `f` and Delete over the canvas and stands them
  // down on this report. Without it a Backspace meant for a parameter field
  // deletes the selected component instead (#584).
  test.beforeEach(async ({ page }) => {
    await page.goto(WORKBENCH_STORY, { waitUntil: "networkidle" });
    await waitForLayout(page);
    await recordFocusReports(page);
    await page.locator(OPEN_PARAMS).click();
    await expect(page.locator(CARD)).toBeVisible();
  });

  test("reports focused while the caret sits in a parameter field", async ({
    page,
  }) => {
    await page.locator("#f-startTime").click();
    await page.keyboard.type("2");

    // The caret is in a plain `<input>`, two shadow roots down: what hides it
    // from an outside listener is the retargeting, not the element's type.
    expect(await deepActiveTag(page)).toBe("input");
    await expect.poll(() => lastFocusReport(page)).toBe(true);
  });

  test("reports unfocused once the canvas takes the focus back", async ({
    page,
  }) => {
    await page.locator("#f-startTime").click();
    await expect.poll(() => lastFocusReport(page)).toBe(true);

    const canvas = await boxOf(page, "om-graphical-layout");
    await page.mouse.click(canvas.x + 20, canvas.y + canvas.height - 20);

    await expect.poll(() => lastFocusReport(page)).toBe(false);
  });

  test("reports a field taking focus from a sibling of the panel", async ({
    page,
  }) => {
    // The webview renders the canvas and the panel into one shadow root, and a
    // move between them retargets to that root — nothing outside the panel is
    // told about it.
    await page.evaluate(() => {
      const panel = document.querySelector("om-parameter-panel");
      if (panel === null) throw new Error("the story rendered no panel");
      const host = document.createElement("div");
      host.id = "embedder";
      document.body.append(host);
      const root = host.attachShadow({ mode: "open" });
      const sibling = document.createElement("button");
      root.append(sibling, panel);
      sibling.focus();
    });
    await expect.poll(() => lastFocusReport(page)).toBe(false);

    await page.locator("#embedder #f-startTime").click();

    await expect.poll(() => lastFocusReport(page)).toBe(true);
  });

  test("reports unfocused when the panel closes under the caret", async ({
    page,
  }) => {
    await page.locator("#f-startTime").click();
    await expect.poll(() => lastFocusReport(page)).toBe(true);

    await page.keyboard.press("Escape");

    await expect(page.locator(CARD)).toHaveCount(0);
    await expect.poll(() => lastFocusReport(page)).toBe(false);
  });
});
