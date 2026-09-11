/**
 * Wrapper-level tests for `writeClassGraphics`.
 *
 * Uses a stub `CallContext` — this is a unit test of the annotation the
 * wrapper re-emits, not of the OMC API itself.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";

import { writeClassGraphics } from "./writeClassGraphics.js";

/**
 * `getIconAnnotation`'s wire shape: the eight positional `coordinateSystem`
 * slots followed by the graphics list, each slot `null` at its OMC default.
 */
const ICON_WITH_GRID =
  "{-100.0, -100.0, 100.0, 100.0, true, 0.1, 2.0, 2.0, " +
  "{Rectangle(true, {0.0, 0.0}, 0.0, {0, 0, 0}, {255, 255, 255}, " +
  "LinePattern.Solid, FillPattern.Solid, 0.25, BorderPattern.None, " +
  "{{-10.0, -10.0}, {10.0, 10.0}}, 0.0)}}";

function stubCtx(annotation: string): { ctx: CallContext; sent: string[] } {
  const sent: string[] = [];
  const ctx: CallContext = {
    async call(cmd) {
      sent.push(cmd);
      return cmd.startsWith("getIconAnnotation") ? annotation : "true";
    },
    async getErrorString() {
      return { errorString: "" };
    },
  };
  return { ctx, sent };
}

/** The `addClassAnnotation` command the wrapper ends on. */
function written(sent: string[]): string {
  const last = sent.at(-1);
  if (last === undefined) throw new Error("nothing was sent");
  return last;
}

describe("writeClassGraphics: setCoordinateSystem", () => {
  it("keeps the coordinate-system fields the caller did not name", async () => {
    const { ctx, sent } = stubCtx(ICON_WITH_GRID);

    await writeClassGraphics(ctx, {
      typeName: "MyPkg.MyModel",
      layer: "icon",
      op: {
        kind: "setCoordinateSystem",
        coordinateSystem: { extent: [-50, -50, 50, 50] },
      },
    });

    const cmd = written(sent);
    expect(cmd).toContain("extent={{-50, -50}, {50, 50}}");
    expect(cmd).toContain("preserveAspectRatio=true");
    expect(cmd).toContain("initialScale=0.1");
    expect(cmd).toContain("grid={2, 2}");
  });

  it("re-emits the existing shapes untouched", async () => {
    const { ctx, sent } = stubCtx(ICON_WITH_GRID);

    await writeClassGraphics(ctx, {
      typeName: "MyPkg.MyModel",
      layer: "icon",
      op: {
        kind: "setCoordinateSystem",
        coordinateSystem: { initialScale: 1 },
      },
    });

    const cmd = written(sent);
    expect(cmd).toContain("graphics={Rectangle(");
    expect(cmd).toContain("extent={{-10, -10}, {10, 10}}");
  });
});
