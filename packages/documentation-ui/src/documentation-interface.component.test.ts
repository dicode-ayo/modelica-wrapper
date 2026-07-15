/**
 * `<om-documentation-interface>`: it renders the read-only interface sections
 * from a `DocumentationInterface` and renders nothing when every section is
 * empty. The click-to-open contract (the `om-documentation-open-link` event) is
 * verified in the extension host — happy-dom can't dispatch Lit `@click`
 * handlers on these elements.
 *
 * Runs under happy-dom (the package default) so the element mounts.
 */

import { afterEach, describe, expect, it } from "vitest";

import "./documentation-interface.component.js";
import type { OmDocumentationInterface } from "./documentation-interface.component.js";
import type { DocumentationInterface } from "./interface-model.js";

async function mount(
  model: DocumentationInterface | undefined,
): Promise<OmDocumentationInterface> {
  const el = document.createElement(
    "om-documentation-interface",
  ) as OmDocumentationInterface;
  el.model = model;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => document.body.replaceChildren());

const EMPTY: DocumentationInterface = {
  extendsTree: [],
  parameters: [],
  connectors: [],
};

describe("om-documentation-interface", () => {
  it("renders nothing when there is no interface", async () => {
    const el = await mount(undefined);
    expect(el.shadowRoot?.querySelector("section")).toBeNull();
  });

  it("renders nothing when every section is empty", async () => {
    const el = await mount(EMPTY);
    expect(el.shadowRoot?.querySelector("section")).toBeNull();
  });

  it("renders parameter rows with name, value, unit, and description", async () => {
    const el = await mount({
      ...EMPTY,
      parameters: [
        {
          name: "k",
          label: "Gain of controller",
          value: "1.5",
          unit: "rad",
          group: "Parameters",
        },
      ],
    });
    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Parameters");
    expect(text).toContain("k");
    expect(text).toContain("1.5");
    expect(text).toContain("rad");
    expect(text).toContain("Gain of controller");
  });

  it("renders the extends tree with a modelica:// link per base", async () => {
    const el = await mount({
      ...EMPTY,
      extendsTree: [
        {
          name: "Modelica.Blocks.Interfaces.SISO",
          comment: "Single Input Single Output",
          children: [],
        },
      ],
    });
    const link = el.shadowRoot?.querySelector("a");
    expect(link?.getAttribute("href")).toBe(
      "modelica://Modelica.Blocks.Interfaces.SISO",
    );
    expect(el.shadowRoot?.textContent).toContain("Single Input Single Output");
  });

  it("renders connector rows with leaf type and direction", async () => {
    const el = await mount({
      ...EMPTY,
      connectors: [
        { name: "u", label: "u", typeName: "RealInput", direction: "input" },
      ],
    });
    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Connectors");
    expect(text).toContain("RealInput");
    expect(text).toContain("input");
  });

  it("shows a group heading only when more than one group is present", async () => {
    const single = await mount({
      ...EMPTY,
      parameters: [
        { name: "a", label: "a", value: "1", group: "Parameters" },
        { name: "b", label: "b", value: "2", group: "Parameters" },
      ],
    });
    expect(single.shadowRoot?.querySelector("td.group")).toBeNull();

    const multi = await mount({
      ...EMPTY,
      parameters: [
        { name: "a", label: "a", value: "1", group: "Parameters" },
        { name: "b", label: "b", value: "2", group: "Advanced" },
      ],
    });
    expect(multi.shadowRoot?.querySelector("td.group")).not.toBeNull();
  });
});
