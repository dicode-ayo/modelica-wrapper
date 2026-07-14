/**
 * `<om-documentation-editor>`: it registers, mounts a ProseMirror view from
 * `info`, and must not treat a programmatic load as a user edit — otherwise it
 * echoes a change back and, worse, a load transaction captures the editor's
 * transient empty state (`<p></p>`) into the working copy, blanking the doc on
 * the next tab switch (the bug the `loading` guard fixes).
 *
 * The click-driven interactive contract (Edit↔Source switching, formatting, the
 * link input) is verified in Storybook and the extension host: happy-dom can't
 * dispatch Lit `@click` handlers on these light-DOM elements
 * (`handleEvent is not a function`) and misreports `textarea.value` /
 * `contenteditable` for a mounted ProseMirror view, so asserting those here
 * would pin the environment's quirks, not the component.
 *
 * Runs under happy-dom (the package default) so the element actually mounts.
 */

import { afterEach, describe, expect, it } from "vitest";

import "./documentation-editor.component.js";
import {
  EDIT_DEBOUNCE_MS,
  type OmDocumentationEditor,
} from "./documentation-editor.component.js";

const INFO = "<html><p>Hello <strong>world</strong></p></html>";

async function mount(info: string): Promise<OmDocumentationEditor> {
  const el = document.createElement(
    "om-documentation-editor",
  ) as OmDocumentationEditor;
  el.info = info;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

afterEach(() => document.body.replaceChildren());

describe("om-documentation-editor", () => {
  it("mounts the class HTML as a ProseMirror document", async () => {
    const el = await mount(INFO);
    const pm = el.querySelector(".ProseMirror");
    expect(pm).toBeTruthy();
    expect(pm?.textContent).toContain("Hello world");
  });

  it("renders a modelica:// image through the resources map", async () => {
    const uri = "modelica://Modelica/Resources/Images/Logo.png";
    const data = "data:image/png;base64,AAAA";
    const el = document.createElement(
      "om-documentation-editor",
    ) as OmDocumentationEditor;
    el.info = `<html><p><img src="${uri}"></p></html>`;
    el.resources = { [uri]: data };
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    const img = el.querySelector<HTMLImageElement>(".ProseMirror img");
    expect(img?.getAttribute("src")).toBe(data);
  });

  it("re-renders images when resources arrives after mount", async () => {
    const uri = "modelica://Modelica/Resources/Images/Logo.png";
    const data = "data:image/png;base64,BBBB";
    const el = document.createElement(
      "om-documentation-editor",
    ) as OmDocumentationEditor;
    el.info = `<html><p><img src="${uri}"></p></html>`;
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    // Before the map, the node view leaves the unresolved src.
    expect(
      el
        .querySelector<HTMLImageElement>(".ProseMirror img")
        ?.getAttribute("src"),
    ).toBe(uri);

    el.resources = { [uri]: data };
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    expect(
      el
        .querySelector<HTMLImageElement>(".ProseMirror img")
        ?.getAttribute("src"),
    ).toBe(data);
  });

  it("does not emit a change for a load (mount or reverse-sync)", async () => {
    const el = await mount(INFO);
    let emitted = 0;
    el.addEventListener("om-documentation-change", () => (emitted += 1));
    // A reverse sync sets info again; a load must not echo an edit.
    el.info = "<html><p>reloaded</p></html>";
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, EDIT_DEBOUNCE_MS + 50));
    expect(emitted).toBe(0);
  });
});
