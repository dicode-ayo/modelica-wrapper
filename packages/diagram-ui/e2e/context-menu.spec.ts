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

/** Name of the first component in the story's layout. */
async function firstComponentName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector("om-graphical-layout") as HTMLElement & {
      layout: { components: Record<string, unknown> };
    };
    return Object.keys(el.layout.components)[0];
  });
}

/** Viewport coordinates of a component's centre (via the scene projection). */
async function componentCentre(
  page: Page,
  name: string,
): Promise<{ x: number; y: number }> {
  const pt = await page.evaluate((n: string) => {
    const el = document.querySelector("om-graphical-layout") as HTMLElement & {
      layout: {
        components: Record<string, { placement: { extent: number[][] } }>;
      };
    };
    const [[x1, y1], [x2, y2]] = el.layout.components[n].placement.extent;
    const scene = el.shadowRoot?.querySelector("om-scene") as HTMLElement & {
      diagramToClient: (
        x: number,
        y: number,
      ) => { x: number; y: number } | null;
    };
    return scene.diagramToClient((x1 + x2) / 2, (y1 + y2) / 2);
  }, name);
  if (!pt) {
    throw new Error("scene not ready");
  }
  return pt;
}

async function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const el = document.querySelector("om-graphical-layout") as HTMLElement & {
      selection: string[];
    };
    return el.selection;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(STORY, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const el = document.querySelector("om-graphical-layout") as
      | (HTMLElement & { layout?: { components?: object } })
      | null;
    return Boolean(el?.layout?.components);
  });
});

test("right-click selects the clicked component and opens its menu", async ({
  page,
}) => {
  const name = await firstComponentName(page);
  const c = await componentCentre(page, name);
  await page.mouse.click(c.x, c.y, { button: "right" });

  expect(await selection(page)).toContain(`c:${name}`);
  await expect(page.locator("om-context-menu button")).toHaveCount(5);
});

test("right-click on empty space clears the selection and shows no menu", async ({
  page,
}) => {
  const name = await firstComponentName(page);
  await page.evaluate((n: string) => {
    (
      document.querySelector("om-graphical-layout") as HTMLElement & {
        setSelection: (k: string[]) => void;
      }
    ).setSelection([`c:${n}`]);
  }, name);

  const box = await page.locator("om-graphical-layout").boundingBox();
  if (!box) {
    throw new Error("no canvas box");
  }
  await page.mouse.click(box.x + 6, box.y + 6, { button: "right" });

  expect(await selection(page)).toEqual([]);
  await expect(page.locator("om-context-menu button")).toHaveCount(0);
});

test("picking a command runs it and closes the menu", async ({ page }) => {
  const name = await firstComponentName(page);
  const c = await componentCentre(page, name);
  const before = await page.evaluate((n: string) => {
    const el = document.querySelector("om-graphical-layout") as HTMLElement & {
      layout: {
        components: Record<string, { placement: { rotation?: number } }>;
      };
    };
    return el.layout.components[n].placement.rotation ?? 0;
  }, name);

  await page.mouse.click(c.x, c.y, { button: "right" });
  await page
    .locator('om-context-menu button[data-id="diagram.rotateCw"]')
    .click();

  await expect(page.locator("om-context-menu button")).toHaveCount(0);
  const after = await page.evaluate((n: string) => {
    const el = document.querySelector("om-graphical-layout") as HTMLElement & {
      layout: {
        components: Record<string, { placement: { rotation?: number } }>;
      };
    };
    return el.layout.components[n].placement.rotation ?? 0;
  }, name);
  expect(after).not.toBe(before);
});

test("the menu tracks its diagram point through zoom", async ({ page }) => {
  const name = await firstComponentName(page);
  const c = await componentCentre(page, name);
  await page.mouse.click(c.x, c.y, { button: "right" });

  const menu = page.locator("om-context-menu [role='menu']");
  const before = await menu.boundingBox();
  if (!before) {
    throw new Error("menu not open");
  }

  // Zoom toward a corner so the anchored component's screen position shifts.
  const box = await page.locator("om-graphical-layout").boundingBox();
  if (!box) {
    throw new Error("no canvas box");
  }
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(150);

  const after = await menu.boundingBox();
  if (!after) {
    throw new Error("menu closed unexpectedly");
  }
  expect({ x: after.x, y: after.y }).not.toEqual({ x: before.x, y: before.y });
});
