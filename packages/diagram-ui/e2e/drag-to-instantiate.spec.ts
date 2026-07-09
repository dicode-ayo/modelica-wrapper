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

test("a package row is not a drag source", async ({ page }) => {
  await page.goto(WORKBENCH_STORY, { waitUntil: "networkidle" });
  const before = await componentCount(page);

  // Tree mode, no search: the roots are the packages `Modelica` and `Complex`.
  const root = page.locator("om-library-tree .row", { hasText: "Modelica" });
  await expect(root).toBeVisible();

  await root.dragTo(page.locator("om-scene"));

  // `addComponent` does not validate: OMC writes a package in as a component.
  await expect.poll(() => componentCount(page)).toBe(before);
  // Headless Tree marks every row draggable; the props are stripped instead.
  await expect(root).not.toHaveAttribute("draggable", "true");
});

test("a non-instantiable search hit is not a drag source", async ({ page }) => {
  await page.goto(WORKBENCH_STORY, { waitUntil: "networkidle" });
  const before = await componentCount(page);

  // `Modelica.Math.sin` is a function; the fixture's search returns it for "sin".
  await page.locator("om-library-tree input.search").fill("sin");
  const hit = page.locator("om-library-tree .row", { hasText: "sin" }).last();
  await expect(hit).toBeVisible();

  await hit.dragTo(page.locator("om-scene"));
  await expect.poll(() => componentCount(page)).toBe(before);
  // Search rows bind the attribute directly rather than going through HT.
  await expect(hit).not.toHaveAttribute("draggable", "true");
});

const PLACEMENT_STORY =
  "/iframe.html?id=diagram-ui-librarytree--placement-drag&viewMode=story";

test("a package row does not arm host-mediated placement", async ({ page }) => {
  await page.goto(PLACEMENT_STORY, { waitUntil: "networkidle" });

  const root = page.locator("om-library-tree .row", { hasText: "Modelica" });
  await expect(root).toBeVisible();
  await root.hover();
  await page.mouse.down();
  await page.mouse.up();

  // The story reports every om-library-placement-start it receives.
  await expect(page.locator("#om-library-tree-placement")).toHaveText(
    "No placement yet.",
  );
});

test("a class row does arm host-mediated placement", async ({ page }) => {
  await page.goto(PLACEMENT_STORY, { waitUntil: "networkidle" });

  await page.locator("om-library-tree input.search").fill("Gain");
  const hit = page.locator("om-library-tree .row", { hasText: "Gain" }).first();
  await expect(hit).toBeVisible();
  await hit.hover();
  await page.mouse.down();
  await page.mouse.up();

  await expect(page.locator("#om-library-tree-placement")).toContainText(
    "Placing:",
  );
});
