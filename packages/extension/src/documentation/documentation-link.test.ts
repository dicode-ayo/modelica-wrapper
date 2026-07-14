/**
 * `parseModelicaLink` classifies a `modelica://` href into a class
 * cross-reference or a resource path, driving how the host opens it.
 */

import { describe, expect, it } from "vitest";

import { parseModelicaLink } from "./documentation-link.js";

describe("parseModelicaLink", () => {
  it("reads a dotted class reference", () => {
    expect(parseModelicaLink("modelica://Modelica.Blocks.Types.Init")).toEqual({
      kind: "class",
      className: "Modelica.Blocks.Types.Init",
    });
  });

  it("treats a path segment as a resource", () => {
    const href = "modelica://Modelica/Resources/Documentation/UsersGuide.html";
    expect(parseModelicaLink(href)).toEqual({ kind: "resource", uri: href });
  });

  it("drops a trailing fragment on a class reference", () => {
    expect(parseModelicaLink("modelica://Pkg.Cls#section")).toEqual({
      kind: "class",
      className: "Pkg.Cls",
    });
  });

  it("returns null for a non-modelica or empty href", () => {
    expect(parseModelicaLink("https://example.com")).toBeNull();
    expect(parseModelicaLink("modelica://")).toBeNull();
  });
});
