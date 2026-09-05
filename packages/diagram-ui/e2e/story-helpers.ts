/**
 * Shared helpers for the Storybook-driven specs.
 */

import type { Page } from "@playwright/test";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Viewport box of the first match, or throws — specs want the box, not a null. */
export async function boxOf(
  page: Page,
  selector: string,
): Promise<BoundingBox> {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    throw new Error(`no box for ${selector}`);
  }
  return box;
}

/** Resolves once `<om-graphical-layout>` has a layout to render. */
export async function waitForLayout(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.querySelector("om-graphical-layout") as
      (HTMLElement & { layout?: { components?: object } }) | null;
    return Boolean(el?.layout?.components);
  });
}
