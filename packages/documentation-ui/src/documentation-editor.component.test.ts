/**
 * A mount smoke test for `<om-documentation-editor>` — it registers, mounts a
 * ProseMirror view from `info`, and renders the class's content. The
 * interactive contract (edit → `om-documentation-change`, Source tab,
 * read-only, no-echo-on-load) is verified in Storybook and the extension host:
 * happy-dom is unreliable for a mounted ProseMirror view (it misreports
 * `textarea.value` and `contenteditable`), so asserting those here would pin the
 * environment's quirks, not the component.
 *
 * Runs under happy-dom (the package default) so the element actually mounts.
 */

import { afterEach, describe, expect, it } from "vitest";

import "./documentation-editor.component.js";
import type { OmDocumentationEditor } from "./documentation-editor.component.js";

afterEach(() => document.body.replaceChildren());

describe("om-documentation-editor", () => {
  it("mounts the class HTML as a ProseMirror document", async () => {
    const el = document.createElement(
      "om-documentation-editor",
    ) as OmDocumentationEditor;
    el.info = "<html><p>Hello <strong>world</strong></p></html>";
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));

    const pm = el.querySelector(".ProseMirror");
    expect(pm).toBeTruthy();
    expect(pm?.textContent).toContain("Hello world");
  });
});
