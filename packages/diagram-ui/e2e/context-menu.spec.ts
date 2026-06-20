/**
 * Real-browser coverage for the diagram context menu (#185): right-click on a
 * selection opens the menu from the command registry, and picking a command
 * runs it. happy-dom can't verify this — a Lit `@event` listener on a custom
 * element doesn't fire there, and the contextMenu interaction needs the live
 * Babylon pointer path.
 */

import { test, expect, type Page } from "@playwright/test";

const STORY =
  "/iframe.html?id=diagram-ui-graphicallayout--editable&viewMode=story";

async function firstComponent(
  page: Page,
): Promise<{ name: string; rotation: number }> {
  return page.evaluate(() => {
    const el = document.querySelector("om-graphical-layout") as HTMLElement & {
      layout: {
        components: Record<string, { placement: { rotation?: number } }>;
      };
      setSelection: (keys: string[]) => void;
    };
    const name = Object.keys(el.layout.components)[0];
    el.setSelection([`c:${name}`]);
    return {
      name,
      rotation: el.layout.components[name].placement.rotation ?? 0,
    };
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

test("right-click on a selection opens the command menu", async ({ page }) => {
  await firstComponent(page);

  const box = await page.locator("om-graphical-layout").boundingBox();
  if (!box) {
    throw new Error("no canvas box");
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right",
  });

  const items = page.locator("om-context-menu button");
  await expect(items).toHaveCount(5);
  await expect(
    page.locator('om-context-menu button[data-id="diagram.rotateCw"]'),
  ).toBeVisible();
});

test("picking a command runs it and closes the menu", async ({ page }) => {
  const before = await firstComponent(page);

  const box = await page.locator("om-graphical-layout").boundingBox();
  if (!box) {
    throw new Error("no canvas box");
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right",
  });
  await page
    .locator('om-context-menu button[data-id="diagram.rotateCw"]')
    .click();

  await expect(page.locator("om-context-menu button")).toHaveCount(0);
  const after = await page.evaluate((name: string) => {
    const el = document.querySelector("om-graphical-layout") as HTMLElement & {
      layout: {
        components: Record<string, { placement: { rotation?: number } }>;
      };
    };
    return el.layout.components[name].placement.rotation ?? 0;
  }, before.name);
  expect(after).not.toBe(before.rotation);
});
