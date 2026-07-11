/**
 * Real-browser coverage for the drag-to-place preview: an armed placement whose
 * class has resolved renders as the actual component node, tracking the cursor,
 * before it is committed. happy-dom can't run the PixiJS scene, so the node only
 * exists in a real browser.
 */

import { expect, test, type Page } from "@playwright/test";

const STORY =
  "/iframe.html?id=diagram-ui-diagramworkbench--default&viewMode=story";

const GAIN = "Modelica.Blocks.Math.Gain";

const nodeCount = (page: Page): Promise<number> =>
  page.locator("om-graphical-layout").locator("om-component").count();

/** Arm a placement for `GAIN` and supply its definition from the story layout,
 *  so the preview has a real class to render. */
async function armPreview(page: Page): Promise<void> {
  await page.locator("om-graphical-layout").evaluate((node, gain) => {
    const el = node as unknown as {
      layout: { classes: Record<string, unknown> };
      beginPlacement(name: string): void;
      setPlacementPreview(def: unknown): void;
    };
    el.beginPlacement(gain);
    el.setPlacementPreview(el.layout.classes[gain]);
  }, GAIN);
}

async function sceneCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator("om-scene").boundingBox();
  if (!box) throw new Error("scene not laid out");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("an armed, resolved placement renders the component node", async ({
  page,
}) => {
  await page.goto(STORY, { waitUntil: "networkidle" });
  await expect(page.locator("om-scene")).toBeVisible();
  const before = await nodeCount(page);

  await armPreview(page);
  const center = await sceneCenter(page);
  await page.mouse.move(center.x, center.y);

  // The preview injects one component node on top of the layout's own.
  await expect.poll(() => nodeCount(page)).toBe(before + 1);
});

test("the preview node replaces the crosshair, keeping the hint", async ({
  page,
}) => {
  await page.goto(STORY, { waitUntil: "networkidle" });
  const before = await nodeCount(page);
  await armPreview(page);
  const center = await sceneCenter(page);
  await page.mouse.move(center.x, center.y);

  // The real node is in the scene, and the ghost keeps only the chip.
  await expect.poll(() => nodeCount(page)).toBe(before + 1);
  const ghost = page.locator("om-graphical-layout").locator(".placement-ghost");
  await expect(ghost.locator(".placement-chip")).toContainText("Placing Gain");
  await expect(ghost.locator(".placement-crosshair")).toHaveCount(0);
});

test("the preview node is not selectable", async ({ page }) => {
  await page.goto(STORY, { waitUntil: "networkidle" });
  await page.locator("om-graphical-layout").evaluate((node) => {
    (node as unknown as { __sel: unknown[] }).__sel = [];
    node.addEventListener("om-selection-change", (e) =>
      (node as unknown as { __sel: unknown[] }).__sel.push(
        (e as CustomEvent).detail,
      ),
    );
  });
  await armPreview(page);
  const center = await sceneCenter(page);
  await page.mouse.move(center.x, center.y);
  // Press on the preview node — placement owns the pointer, so no selection.
  await page.mouse.down();
  const selWhilePlacing = await page
    .locator("om-graphical-layout")
    .evaluate((node) => (node as unknown as { __sel: unknown[] }).__sel.length);
  await page.mouse.up();

  expect(selWhilePlacing).toBe(0);
});

test("moving off-canvas drops the preview node", async ({ page }) => {
  await page.goto(STORY, { waitUntil: "networkidle" });
  const before = await nodeCount(page);
  await armPreview(page);
  const center = await sceneCenter(page);
  await page.mouse.move(center.x, center.y);
  await expect.poll(() => nodeCount(page)).toBe(before + 1);

  await page.mouse.move(2, 2);
  await expect.poll(() => nodeCount(page)).toBe(before);
});

test("a mismatched definition does not paint a preview", async ({ page }) => {
  await page.goto(STORY, { waitUntil: "networkidle" });
  const before = await nodeCount(page);

  // Arm one class, then resolve a definition for a *different* class — a late
  // reply for a superseded placement must not paint a stale node.
  await page.locator("om-graphical-layout").evaluate((node, gain) => {
    const el = node as unknown as {
      layout: { classes: Record<string, unknown> };
      beginPlacement(name: string): void;
      setPlacementPreview(def: unknown): void;
    };
    el.beginPlacement(gain);
    el.setPlacementPreview({
      ...(el.layout.classes[gain] as object),
      name: "Some.Other.Class",
    });
  }, GAIN);
  const center = await sceneCenter(page);
  await page.mouse.move(center.x, center.y);

  await expect.poll(() => nodeCount(page)).toBe(before);
});
