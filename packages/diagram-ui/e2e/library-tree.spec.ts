/**
 * Real-browser coverage for `<om-library-tree>`'s lazy, per-visible-row icon
 * fetch and `invalidateIcon`. happy-dom can't render `<lit-virtualizer>` (its
 * constructor needs a real `ResizeObserver`), so the fetch driven by the
 * virtualizer's `rangeChanged` event — and the `.icon-svg` markup it produces
 * — isn't observable through the vitest suite; that harness instead drove the
 * private `renderRow`/`onTreeRangeChanged`/`onSearchRangeChanged` directly.
 * The `WithIcons` story logs every `iconSvg` call to `#om-library-tree-icon-calls`.
 */

import { test, expect, type Page } from "@playwright/test";

const STORY =
  "/iframe.html?id=diagram-ui-librarytree--with-icons&viewMode=story";

interface LibraryTreeEl extends HTMLElement {
  invalidateIcon(className: string): void;
}

function row(page: Page, label: string) {
  return page.locator("om-library-tree .row", { hasText: label }).first();
}

async function iconCalls(page: Page): Promise<string[]> {
  const text = await page.locator("#om-library-tree-icon-calls").textContent();
  return text ? (JSON.parse(text) as string[]) : [];
}

function invalidateIcon(page: Page, className: string): Promise<void> {
  return page.evaluate(
    (name) =>
      (
        document.querySelector("om-library-tree") as unknown as LibraryTreeEl
      ).invalidateIcon(name),
    className,
  );
}

test("fetches and renders icons lazily for rows the virtualizer shows, and only those", async ({
  page,
}) => {
  await page.goto(STORY, { waitUntil: "networkidle" });

  // Both roots ("Modelica", "Complex") are within the initial viewport.
  await expect(row(page, "Modelica").locator(".icon-svg")).toBeVisible();
  await expect(row(page, "Complex").locator(".icon-svg")).toBeVisible();

  const requested = await iconCalls(page);
  expect(requested).toContain("Modelica");
  expect(requested).toContain("Complex");
  // "Modelica.Blocks" is a collapsed child package — never rendered, so
  // never fetched.
  expect(requested).not.toContain("Modelica.Blocks");
});

test("invalidateIcon re-fetches a shown icon and skips one never shown", async ({
  page,
}) => {
  await page.goto(STORY, { waitUntil: "networkidle" });

  const title = row(page, "Modelica").locator(".icon-svg title");
  await expect(title).toHaveText("Modelica v1");

  await invalidateIcon(page, "Modelica");
  await expect(title).toHaveText("Modelica v2");

  const before = await iconCalls(page);
  await invalidateIcon(page, "Modelica.Blocks.Math.Gain");
  expect(await iconCalls(page)).toEqual(before);
});

test("search rows also get their icons lazily fetched; ancestor packages don't", async ({
  page,
}) => {
  await page.goto(STORY, { waitUntil: "networkidle" });

  await page.locator("om-library-tree input.search").fill("gain");
  const hit = row(page, "Gain");
  await expect(hit).toBeVisible();
  await expect(hit.locator(".icon-svg")).toBeVisible();

  const requested = await iconCalls(page);
  expect(requested).toContain("Modelica.Blocks.Math.Gain");
  // "Blocks" appears only as ancestor context in the search hierarchy — it
  // keeps its restriction badge, never an icon fetch.
  expect(requested).not.toContain("Modelica.Blocks");
  await expect(
    page
      .locator("om-library-tree .row", { hasText: /^Blocks$/ })
      .locator(".icon-svg"),
  ).toHaveCount(0);
});
