import { describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";

vi.mock("../src/scene/render-scheduler.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/scene/render-scheduler.js")
  >()),
  requestSceneRender: vi.fn(),
}));

import {
  buildWireMesh,
  buildRectMesh,
  updateRectMesh,
  disposeOverlayMesh,
  CONNECT_OK_COLOR,
} from "../src/base/overlay-mesh.js";
import { requestSceneRender } from "../src/scene/render-scheduler.js";

function makeScene(): { parent: Container } {
  return { parent: new Container({ label: "root" }) };
}

describe("overlay-mesh", () => {
  it("buildWireMesh builds the wire without its pick tube", () => {
    const { parent } = makeScene();

    const wire = buildWireMesh(
      parent,
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      CONNECT_OK_COLOR,
    );

    expect(wire).not.toBeNull();
    expect(parent.getChildByLabel("om-gesture-wire", true)).not.toBeNull();
    // The pick tube is feedback-only; it must not linger.
    expect(parent.getChildByLabel("om-gesture-wire.hit", true)).toBeNull();
  });

  it("disposeOverlayMesh removes the graphic and tolerates null", () => {
    const { parent } = makeScene();

    const wire = buildWireMesh(
      parent,
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      CONNECT_OK_COLOR,
    );
    disposeOverlayMesh(wire);
    expect(parent.getChildByLabel("om-gesture-wire", true)).toBeNull();

    expect(() => disposeOverlayMesh(null)).not.toThrow();
  });

  it("requests a render on build and on dispose (on-demand rendering)", () => {
    const { parent } = makeScene();

    vi.mocked(requestSceneRender).mockClear();
    const wire = buildWireMesh(
      parent,
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      CONNECT_OK_COLOR,
    );
    expect(requestSceneRender).toHaveBeenCalledWith(parent);

    vi.mocked(requestSceneRender).mockClear();
    disposeOverlayMesh(wire);
    // Without this the disposed graphic lingers on screen until an unrelated
    // frame.
    expect(requestSceneRender).toHaveBeenCalledWith(parent);
  });

  it("buildRectMesh builds the rubber-band outline", () => {
    const { parent } = makeScene();

    const rect = buildRectMesh(parent, { x1: 0, y1: 0, x2: 10, y2: 10 });

    expect(rect).not.toBeNull();
    expect(parent.getChildByLabel("om-rubber-band", true)).not.toBeNull();
    disposeOverlayMesh(rect);
    expect(parent.getChildByLabel("om-rubber-band", true)).toBeNull();
  });

  it("updateRectMesh rewrites the outline in place (no new graphic)", () => {
    const { parent } = makeScene();

    const rect = buildRectMesh(parent, { x1: 0, y1: 0, x2: 10, y2: 10 });
    expect(parent.getChildByLabel("om-rubber-band", true)).toBe(rect);
    vi.mocked(requestSceneRender).mockClear();
    updateRectMesh(rect, { x1: 0, y1: 0, x2: 20, y2: 30 });

    expect(
      parent.children.filter((c) => c.label === "om-rubber-band"),
    ).toHaveLength(1);
    // Rewritten in place: the same Graphics instance survives, not a
    // dispose-and-recreate.
    expect(parent.getChildByLabel("om-rubber-band", true)).toBe(rect);
    expect(requestSceneRender).toHaveBeenCalledWith(parent);
  });

  it("does not accrue graphics across repeated build/dispose cycles", () => {
    const { parent } = makeScene();

    let wire = buildWireMesh(
      parent,
      { x: 0, y: 0 },
      { x: 4, y: 1 },
      CONNECT_OK_COLOR,
    );
    for (let i = 2; i <= 8; i++) {
      disposeOverlayMesh(wire);
      wire = buildWireMesh(
        parent,
        { x: 0, y: 0 },
        { x: i * 4, y: i },
        CONNECT_OK_COLOR,
      );
    }
    // Each build releases the previous graphic, so the parent never holds
    // more than the single live wire — the object-graph analogue of
    // Babylon's "no material accrual" invariant.
    expect(parent.children).toHaveLength(1);
  });
});
