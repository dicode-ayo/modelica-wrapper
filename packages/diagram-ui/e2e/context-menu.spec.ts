/**
 * Real-browser coverage for the diagram context menu (#185): right-click sets
 * the selection it acts on, opens the registry-backed menu, runs the picked
 * command, and the menu tracks its diagram point through zoom. happy-dom can't
 * verify any of this — a Lit `@event` listener on a custom element doesn't fire
 * there, and the contextMenu + pan/zoom paths need the live Babylon renderer.
 */

import { test, expect, type Page } from "@playwright/test";

const STORY =
  "/iframe.html?id=diagram-ui-graphicallayout--editable&viewMode=story";

// The host/scene shapes the in-page helpers reach for. Defined once here rather
// than re-cast inline in every `page.evaluate` — the types are erased across
// the serialization boundary, so a single shared shape is all that's needed.
interface LayoutEl extends HTMLElement {
  layout: {
    components: Record<
      string,
      { placement: { extent: number[][]; rotation?: number } }
    >;
  };
  selection: string[];
  setSelection: (keys: string[]) => void;
}
interface SceneEl extends HTMLElement {
  diagramToClient: (x: number, y: number) => { x: number; y: number } | null;
}

/** First component name + the viewport centre of its placement. */
async function firstComponent(
  page: Page,
): Promise<{ name: string; centre: { x: number; y: number } }> {
  const result = await page.evaluate(() => {
    const el = document.querySelector("om-graphical-layout") as LayoutEl;
    const name = Object.keys(el.layout.components)[0];
    const [[x1, y1], [x2, y2]] = el.layout.components[name].placement.extent;
    const scene = el.shadowRoot?.querySelector("om-scene") as SceneEl;
    return {
      name,
      centre: scene.diagramToClient((x1 + x2) / 2, (y1 + y2) / 2),
    };
  });
  if (!result.centre) {
    throw new Error("scene not ready");
  }
  return { name: result.name, centre: result.centre };
}

const selection = (page: Page): Promise<string[]> =>
  page.evaluate(
    () => (document.querySelector("om-graphical-layout") as LayoutEl).selection,
  );

const rotationOf = (page: Page, name: string): Promise<number> =>
  page.evaluate(
    (n: string) =>
      (document.querySelector("om-graphical-layout") as LayoutEl).layout
        .components[n].placement.rotation ?? 0,
    name,
  );

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

test.beforeEach(async ({ page }) => {
  await page.goto(STORY, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const el = document.querySelector("om-graphical-layout") as
      (HTMLElement & { layout?: { components?: object } }) | null;
    return Boolean(el?.layout?.components);
  });
});

test("right-click selects the clicked component and opens its menu", async ({
  page,
}) => {
  const { name, centre } = await firstComponent(page);
  await page.mouse.click(centre.x, centre.y, { button: "right" });

  expect(await selection(page)).toContain(`c:${name}`);
  // Naming them beats counting them: a count says nothing about which command
  // went missing, and every added command breaks it without saying why.
  await expect(page.locator("om-context-menu button")).toHaveText([
    "Copy",
    "Delete",
    "Rotate clockwise",
    "Rotate counterclockwise",
    "Flip horizontal",
    "Flip vertical",
    "Change class…",
  ]);
});

test("right-click on empty space clears the selection and offers host navigation only", async ({
  page,
}) => {
  const { name } = await firstComponent(page);
  await page.evaluate((n: string) => {
    (document.querySelector("om-graphical-layout") as LayoutEl).setSelection([
      `c:${n}`,
    ]);
  }, name);

  const box = await boxOf(page, "om-graphical-layout");
  await page.mouse.click(box.x + 6, box.y + 6, { button: "right" });

  expect(await selection(page)).toEqual([]);
  // Bare canvas resolves Go to Definition to the host class itself (#514);
  // Go to Declaration needs a single selected instance, so it stays out.
  await expect(page.locator("om-context-menu button")).toHaveText([
    "Go to Definition",
  ]);
});

test("picking a command runs it and closes the menu", async ({ page }) => {
  const { name, centre } = await firstComponent(page);
  const before = await rotationOf(page, name);

  await page.mouse.click(centre.x, centre.y, { button: "right" });
  await page
    .locator('om-context-menu button[data-id="diagram.rotateCw"]')
    .click();

  await expect(page.locator("om-context-menu button")).toHaveCount(0);
  expect(await rotationOf(page, name)).not.toBe(before);
});

test("the menu tracks its diagram point through zoom", async ({ page }) => {
  const { centre } = await firstComponent(page);
  await page.mouse.click(centre.x, centre.y, { button: "right" });

  const before = await boxOf(page, "om-context-menu [role='menu']");

  // Zoom toward a corner so the anchored component's screen position shifts.
  const box = await boxOf(page, "om-graphical-layout");
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(150);

  const after = await boxOf(page, "om-context-menu [role='menu']");
  expect({ x: after.x, y: after.y }).not.toEqual({ x: before.x, y: before.y });
});
