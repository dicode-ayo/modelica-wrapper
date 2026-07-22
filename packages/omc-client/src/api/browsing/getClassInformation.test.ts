/**
 * Wrapper-level tests for `getClassInformation`'s tuple parsing, pinning the
 * OMC 1.27.0 shape: an annotation-free / not-found class comes back with the
 * four trailing version-annotation fields dropped (18 items, not 22).
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";

import { getClassInformation } from "./getClassInformation.js";

function stubCtx(response: string): CallContext {
  return {
    async call() {
      return response;
    },
    async getErrorString() {
      return { errorString: "" };
    },
  };
}

const FULL_22 =
  '("model", "A resistor", false, false, false, "/ws/R.mo", false, 2, 1, 16, 14, {}, false, false, "", "", false, "", "1.0", "2020", "2020-01-01", "abc123")';

// OMC 1.27.0 not-found / annotation-free: 18 items, trailing four dropped.
const NOT_FOUND_18 =
  '("", "", false, false, false, "", false, 0, 0, 0, 0, {}, false, false, "", "", false, "")';

describe("getClassInformation: tuple parsing", () => {
  it("parses the full 22-field response", async () => {
    const out = await getClassInformation(stubCtx(FULL_22), {
      typeName: "P.R",
    });
    expect(out.restriction).toBe("model");
    expect(out.fileName).toBe("/ws/R.mo");
    expect(out.lineNumberStart).toBe(2);
    expect(out.versionDate).toBe("1.0");
    expect(out.revisionId).toBe("abc123");
  });

  it("parses the 18-field response, defaulting the dropped version fields", async () => {
    const out = await getClassInformation(stubCtx(NOT_FOUND_18), {
      typeName: "P.Missing",
    });
    expect(out.restriction).toBe("");
    expect(out.fileName).toBe("");
    // The four fields OMC 1.27.0 drops fall back to empty.
    expect(out.versionDate).toBe("");
    expect(out.versionBuild).toBe("");
    expect(out.dateModified).toBe("");
    expect(out.revisionId).toBe("");
  });

  it("throws when even the core fields are missing", async () => {
    await expect(
      getClassInformation(stubCtx('("", "", false)'), { typeName: "P.X" }),
    ).rejects.toThrow(/want >=18/);
  });
});
