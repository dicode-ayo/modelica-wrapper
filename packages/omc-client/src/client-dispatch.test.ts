/**
 * `invoke()` parses its input against the function's schema; a method that
 * reaches its wrapper directly does not, and the wrapper is where an argument
 * becomes command text (issue #656). The two spellings are one line apart in
 * `client.ts` and nothing in the types tells them apart, so the older one is
 * read back off the source instead.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), "client.ts");

/**
 * `return <ns>.<fn>(this…)` — a wrapper reached without `invoke`.
 *
 * Matching the call rather than the method signature is deliberate: a default
 * parameter, an overload or a renamed argument all change the signature, and
 * every one of those has already hidden a method from an earlier version of
 * this check.
 */
const DELEGATES_DIRECTLY = /\n\s*return (\w+)\.(\w+)\(this[,)]/g;

describe("every OmcClient method taking an input", () => {
  it("reaches its wrapper through invoke, so the schema cannot be skipped", async () => {
    const src = await readFile(CLIENT, "utf8");

    const bypassing = [...src.matchAll(DELEGATES_DIRECTLY)].map(
      (m) => `${m[1]}.${m[2]}`,
    );

    expect(bypassing).toEqual([]);
  });
});
