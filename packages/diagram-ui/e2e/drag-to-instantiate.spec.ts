/**
 * Real-browser coverage for drag-to-instantiate: a class row dragged from the
 * docked `<om-library-tree>` onto the canvas instantiates it at the drop point.
 * happy-dom can't run HTML5 drag-and-drop (`dragstart` never populates a real
 * `DataTransfer`), so the unit drop test synthesises the event and only pins
 * the handler. This drives the whole gesture.
 */

import { test, expect, type Page } from "@playwright/test";

const WORKBENCH_STORY =
  "/iframe.html?id=diagram-ui-diagramworkbench--default&viewMode=story";
const WORKBENCH_STORY_READONLY = `${WORKBENCH_STORY}&args=readonly:!true`;

/** A `block` — openable, so the tree makes its row a drag source. */
const DRAGGABLE_CLASS = "Modelica.Blocks.Math.Gain";

interface LayoutEl extends HTMLElement {
  layout: { components: Record<string, unknown> };
}

const componentCount = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector<LayoutEl>("om-graphical-layout");
    return Object.keys(el?.layout.components ?? {}).length;
  });

/** Search narrows the tree to a flat result list, which avoids expanding the
 *  lazy tree row by row to reach a leaf. */
async function searchFor(page: Page, query: string): Promise<void> {
  await page.locator("om-library-tree input.search").fill(query);
  await expect(
    page.locator("om-library-tree .row", { hasText: "Gain" }).first(),
  ).toBeVisible();
}

test("dragging a class row onto the canvas instantiates it", async ({
  page,
}) => {
  await page.goto(WORKBENCH_STORY, { waitUntil: "networkidle" });

  const before = await componentCount(page);
  await searchFor(page, DRAGGABLE_CLASS);

  const row = page.locator("om-library-tree .row[draggable='true']").first();
  await row.dragTo(page.locator("om-scene"));

  await expect.poll(() => componentCount(page)).toBe(before + 1);
});

test("a readonly canvas refuses the drop", async ({ page }) => {
  await page.goto(WORKBENCH_STORY_READONLY, { waitUntil: "networkidle" });

  const before = await componentCount(page);
  await searchFor(page, DRAGGABLE_CLASS);

  const row = page.locator("om-library-tree .row[draggable='true']").first();
  await row.dragTo(page.locator("om-scene"));

  await expect.poll(() => componentCount(page)).toBe(before);
});
