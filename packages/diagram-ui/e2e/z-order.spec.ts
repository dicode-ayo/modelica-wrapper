/**
 * Real-browser coverage for the z-order shortcuts (#328). The chords come from
 * `e.key`, which carries the shifted glyph — Ctrl+Shift+] arrives as `}` — so
 * only a real keyboard event proves the binding is live; happy-dom cannot
 * produce the layout-dependent key value.
 */

import { test, expect, type Page } from "@playwright/test";

const LAYOUT_STORY =
  "/iframe.html?id=diagram-ui-graphicallayout--editable&viewMode=story";

interface LayoutEl extends HTMLElement {
  layout: {
    kind: "icon" | "diagram";
    className: string;
    iconLayers: { from: string; shapes: { kind: string }[] }[];
    diagramLayers: { from: string; shapes: { kind: string }[] }[];
  };
  setActiveTool: (tool: string) => void;
  setSelection: (keys: string[]) => void;
}

function hostShapeKinds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const el = document.querySelector("om-graphical-layout") as LayoutEl;
    const layers =
      el.layout.kind === "icon"
        ? el.layout.iconLayers
        : el.layout.diagramLayers;
    return (
      layers.find((l) => l.from === el.layout.className)?.shapes ?? []
    ).map((s) => s.kind);
  });
}

/** Draw one extent primitive by dragging the box `(x1,y1)-(x2,y2)`. */
async function draw(
  page: Page,
  tool: "rectangle" | "ellipse",
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<void> {
  await page.evaluate(
    (t) =>
      (document.querySelector("om-graphical-layout") as LayoutEl).setActiveTool(
        t,
      ),
    tool,
  );
  const box = await page.locator("om-graphical-layout").boundingBox();
  if (!box) throw new Error("no canvas box");
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 8 });
  await page.mouse.up();
}

/** The story starts with no host graphics, so build a two-shape layer. */
async function twoShapes(page: Page): Promise<void> {
  await page.goto(LAYOUT_STORY, { waitUntil: "networkidle" });
  await page.waitForFunction(() =>
    Boolean(
      (document.querySelector("om-graphical-layout") as LayoutEl | null)
        ?.layout,
    ),
  );
  await draw(page, "rectangle", 60, 50, 160, 130);
  await draw(page, "ellipse", 200, 50, 300, 130);
  expect(await hostShapeKinds(page)).toEqual(["rectangle", "ellipse"]);
}

/** Select the host-own shape at `index` and give the canvas key focus. */
async function select(page: Page, index: number, kind: string): Promise<void> {
  await page.evaluate(
    ([i, k]) =>
      (document.querySelector("om-graphical-layout") as LayoutEl).setSelection([
        `shape:${String(k)}:${String(i)}`,
      ]),
    [index, kind] as const,
  );
  await page.locator("om-graphical-layout").focus();
}

test("Ctrl+Shift+] brings the selected shape to the front of the paint order", async ({
  page,
}) => {
  await twoShapes(page);
  await select(page, 0, "rectangle");

  await page.keyboard.press("Control+Shift+BracketRight");

  expect(await hostShapeKinds(page)).toEqual(["ellipse", "rectangle"]);
});

test("Ctrl+[ sends the selected shape backward one slot", async ({ page }) => {
  await twoShapes(page);
  await select(page, 1, "ellipse");

  await page.keyboard.press("Control+BracketLeft");

  expect(await hostShapeKinds(page)).toEqual(["ellipse", "rectangle"]);
});
