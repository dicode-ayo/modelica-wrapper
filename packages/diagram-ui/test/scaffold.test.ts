import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "../src/index.js";

describe("diagram-ui scaffold", () => {
  it("exposes the package name as a smoke export", () => {
    expect(PACKAGE_NAME).toBe("@modelica-wrapper/diagram-ui");
  });
});
