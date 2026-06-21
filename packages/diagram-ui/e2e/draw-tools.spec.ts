/**
 * Real-browser coverage for the draw tools (#187): arming a tool and dragging
 * draws a primitive into the host layer (the live Babylon pointer path, which
 * happy-dom can't run), and the toolbar's draw dropdown arms a shape (a
 * `wa-dropdown` interaction).
 */

import { test, expect, type Page } from "@playwright/test";

const LAYOUT_STORY =
  "/iframe.html?id=diagram-ui-graphicallayout--editable&viewMode=story";
const PANEL_STORY =
  "/iframe.html?id=diagram-ui-actionpanel--default&viewMode=story";
const WORKBENCH_STORY =
  "/iframe.html?id=diagram-ui-diagramworkbench--default&viewMode=story";

const SVG_NS = "http://www.w3.org/2000/svg";

interface LayoutEl extends HTMLElement {
  layout: {
    kind: "icon" | "diagram";
    className: string;
    iconLayers: { from: string; shapes: { kind: string }[] }[];
    diagramLayers: { from: string; shapes: { kind: string }[] }[];
  };
  setActiveTool: (tool: string) => void;
}

/** Shapes in the host's own layer (`from === className`) of the edited layer. */
function hostShapeKinds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const el = document.querySelector("om-graphical-layout") as LayoutEl;
    const layers =
      el.layout.kind === "icon"
        ? el.layout.iconLayers
        : el.layout.diagramLayers;
    const host = layers.find((l) => l.from === el.layout.className);
    return host ? host.shapes.map((s) => s.kind) : [];
  });
}

test("arming the rectangle tool and dragging draws it into the host layer", async ({
  page,
}) => {
  await page.goto(LAYOUT_STORY, { waitUntil: "networkidle" });
  await page.waitForFunction(() =>
    Boolean(
      (document.querySelector("om-graphical-layout") as LayoutEl | null)
        ?.layout,
    ),
  );

  const before = await hostShapeKinds(page);
  await page.evaluate(() =>
    (document.querySelector("om-graphical-layout") as LayoutEl).setActiveTool(
      "rectangle",
    ),
  );

  // An armed tool draws anywhere on the canvas; drag out a box.
  const box = await page.locator("om-graphical-layout").boundingBox();
  if (!box) {
    throw new Error("no canvas box");
  }
  await page.mouse.move(box.x + 60, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 130, { steps: 8 });
  await page.mouse.up();

  const after = await hostShapeKinds(page);
  expect(after.length).toBe(before.length + 1);
  expect(after.at(-1)).toBe("rectangle");
});

test("the toolbar draw dropdown arms a shape", async ({ page }) => {
  await page.goto(PANEL_STORY, { waitUntil: "networkidle" });

  await page
    .locator('om-action-panel wa-dropdown wa-button[slot="trigger"]')
    .click();
  await page
    .locator('om-action-panel wa-dropdown-item[value="ellipse"]')
    .click();

  await expect(page.locator(".om-tool-status")).toHaveText("tool: ellipse");
});

test("toolbar buttons render real SVG glyphs", async ({ page }) => {
  await page.goto(PANEL_STORY, { waitUntil: "networkidle" });

  // A `<path>` built with Lit's `html` tag lands in the HTML namespace and
  // renders nothing; the glyphs must be true SVG-namespaced elements.
  const ns = await page.evaluate(() => {
    const panel = document.querySelector("om-action-panel");
    const shape = panel?.shadowRoot
      ?.querySelector("svg.toolbar-icon")
      ?.querySelector("path, rect, ellipse, circle");
    return shape?.namespaceURI ?? null;
  });
  expect(ns).toBe(SVG_NS);
});

test("drawing via the toolbar lands a shape in the host layer", async ({
  page,
}) => {
  await page.goto(WORKBENCH_STORY, { waitUntil: "networkidle" });
  await page.waitForFunction(() =>
    Boolean(
      (document.querySelector("om-graphical-layout") as LayoutEl | null)
        ?.layout,
    ),
  );

  const before = await hostShapeKinds(page);
  await page
    .locator('om-action-panel wa-dropdown wa-button[slot="trigger"]')
    .click();
  await page
    .locator('om-action-panel wa-dropdown-item[value="rectangle"]')
    .click();

  const box = await page.locator("om-graphical-layout").boundingBox();
  if (!box) {
    throw new Error("no canvas box");
  }
  await page.mouse.move(box.x + 70, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 140, { steps: 8 });
  await page.mouse.up();

  const after = await hostShapeKinds(page);
  expect(after.length).toBe(before.length + 1);
  expect(after.at(-1)).toBe("rectangle");
});
