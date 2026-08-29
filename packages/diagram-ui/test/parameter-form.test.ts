/**
 * `<om-parameter-form>`'s `dirty` tracking on `om-parameter-submit` (issue
 * #482): `values` alone can't tell a deliberately-submitted default from a
 * field the user never touched, so the event also carries the set of field
 * names actually edited.
 *
 * The WA components are mocked to inert modules: the real ones are
 * form-associated custom elements that read `ElementInternals`, which
 * happy-dom doesn't implement, so connecting one crashes (see the note in
 * `parameter-panel.test.ts`, which hits the same wall). Nothing here reads a
 * rendered sub-element, so the stub is enough to get the component through
 * its connect/update cycle; a field edit is driven directly through the same
 * internal path a real `wa-input`'s `@input` handler calls.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@awesome.me/webawesome/dist/components/button/button.js", () => ({}));
vi.mock(
  "@awesome.me/webawesome/dist/components/checkbox/checkbox.js",
  () => ({}),
);
vi.mock("@awesome.me/webawesome/dist/components/input/input.js", () => ({}));
vi.mock("@awesome.me/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@awesome.me/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@awesome.me/webawesome/dist/components/tab/tab.js", () => ({}));
vi.mock(
  "@awesome.me/webawesome/dist/components/tab-group/tab-group.js",
  () => ({}),
);
vi.mock(
  "@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js",
  () => ({}),
);

import "../src/parameter-form/parameter-form.component.js";
import type {
  OmParameterForm,
  ParameterFormSubmitDetail,
} from "../src/parameter-form/parameter-form.component.js";
import type { ParameterModel } from "@dicode/omc-client";

/** The private surface `setField`/`onSubmit` — reached directly since a
 *  rendered `wa-input` can't be driven in this environment (see above). */
interface Internals {
  setField(name: string, value: unknown, opts?: { commit?: boolean }): void;
  onSubmit(e: Event): void;
}

function twoFieldModel(): ParameterModel {
  return {
    className: "X",
    fields: [
      {
        name: "a",
        label: "a",
        kind: "string",
        value: "orig-a",
        dialog: { tab: "T", group: "G" },
        unitOptions: [],
      },
      {
        name: "b",
        label: "b",
        kind: "string",
        value: "orig-b",
        dialog: { tab: "T", group: "G" },
        unitOptions: [],
      },
    ],
  };
}

async function mount(model: ParameterModel): Promise<OmParameterForm> {
  const el = document.createElement("om-parameter-form") as OmParameterForm;
  el.model = model;
  document.body.append(el);
  await el.updateComplete;
  return el;
}

function listenForSubmit(
  el: OmParameterForm,
): () => ParameterFormSubmitDetail | undefined {
  let detail: ParameterFormSubmitDetail | undefined;
  el.addEventListener("om-parameter-submit", (e) => {
    detail = (e as CustomEvent<ParameterFormSubmitDetail>).detail;
  });
  return () => detail;
}

describe("<om-parameter-form> dirty tracking", () => {
  it("submits a dirty set naming exactly the fields the user edited", async () => {
    const el = await mount(twoFieldModel());
    const getDetail = listenForSubmit(el);

    (el as unknown as Internals).setField("a", "changed-a");
    await el.updateComplete;
    (el as unknown as Internals).onSubmit(
      new Event("submit", { cancelable: true }),
    );

    const detail = getDetail();
    expect(detail).toBeDefined();
    expect([...(detail?.dirty ?? [])]).toEqual(["a"]);
    // `values` still carries every field, touched or not — only `dirty`
    // distinguishes "the user set this" from "this is where it started".
    expect(detail?.values).toMatchObject({ a: "changed-a", b: "orig-b" });

    el.remove();
  });

  it("submits an empty dirty set when the form is applied untouched", async () => {
    const el = await mount(twoFieldModel());
    const getDetail = listenForSubmit(el);

    (el as unknown as Internals).onSubmit(
      new Event("submit", { cancelable: true }),
    );

    const detail = getDetail();
    expect(detail).toBeDefined();
    expect([...(detail?.dirty ?? [])]).toEqual([]);

    el.remove();
  });
});
