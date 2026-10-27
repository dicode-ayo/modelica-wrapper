import { describe, expect, it } from "vitest";

import { ErrorMessageSchema } from "./getMessagesStringInternal.js";

describe("ErrorMessageSchema", () => {
  it("describes columnEnd as exclusive, matching the extension's diagnostic range mapping", () => {
    const description =
      ErrorMessageSchema.shape.info.shape.columnEnd.description;

    expect(description).toMatch(/exclusive/);
  });
});
