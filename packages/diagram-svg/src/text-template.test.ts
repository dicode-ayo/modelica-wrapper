import { describe, expect, it } from "vitest";

import { interpolateTemplate } from "./text-template.js";

describe("interpolateTemplate", () => {
  it("substitutes %name with the component instance name", () => {
    expect(interpolateTemplate("%name", { name: "spring1" })).toBe("spring1");
  });

  it("substitutes %class with the qualified class name", () => {
    expect(
      interpolateTemplate("%class", {
        class: "Modelica.Mechanics.Rotational.Components.SpringDamper",
      }),
    ).toBe("Modelica.Mechanics.Rotational.Components.SpringDamper");
  });

  it("substitutes %<paramName> from the parameters map", () => {
    expect(interpolateTemplate("d=%d", { parameters: { d: "0.5" } })).toBe(
      "d=0.5",
    );
  });

  it("handles the SpringDamper template with mixed tokens", () => {
    const out = interpolateTemplate("c=%c d=%d", {
      parameters: { c: "100", d: "0.5" },
    });
    expect(out).toBe("c=100 d=0.5");
  });

  it("treats %% as a literal percent sign", () => {
    expect(interpolateTemplate("100%%", {})).toBe("100%");
  });

  it("greedily matches identifiers — %nameSuffix is one token", () => {
    // `nameSuffix` is a distinct parameter; we don't substitute %name
    // and then append "Suffix".
    expect(
      interpolateTemplate("%nameSuffix", {
        name: "instance",
        parameters: { nameSuffix: "ok" },
      }),
    ).toBe("ok");
  });

  it("replaces unknown tokens with the empty string", () => {
    // OMEdit-style: `d=%d` with no `d` param renders as `d=` rather
    // than leaving the raw template token visible.
    expect(interpolateTemplate("d=%d", {})).toBe("d=");
  });

  it("returns the input untouched when no tokens are present", () => {
    expect(interpolateTemplate("just text", { name: "x" })).toBe("just text");
  });

  it("substitutes multiple occurrences of the same token", () => {
    expect(interpolateTemplate("%name / %name", { name: "twin" })).toBe(
      "twin / twin",
    );
  });
});
