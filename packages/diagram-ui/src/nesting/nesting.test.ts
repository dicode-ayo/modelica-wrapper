/**
 * Headless, the scene measures 800 × 600, so a 20-unit box is
 * `20 * 600 / (2 * zoom)` px on screen: 60 px at zoom 100 (closed), 120 px
 * at 50 (closed, but prefetching), 170 px at 6000/170 (mid-band), 300 px at
 * 20 (open).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Graphics, type Container } from "pixi.js";
import type {
  ClassDef,
  DiagramLayout,
  Placement,
  Point,
  PortDef,
} from "@dicode/omc-client";

import type { OmComponent } from "../component/component.component.js";
import type { OmConnection } from "../connection/connection.component.js";
import type { OmLayerGroup } from "../base/layer-group.component.js";
import type { OmGraphicalLayout } from "../graphical-layout/graphical-layout.component.js";
import { entityKeyForNode } from "../interaction/node-keys.js";
import type { OmScene } from "../scene/scene.component.js";
import { mountLayout } from "../../test/harness/interaction-fixtures.js";
import { emptyLayout } from "../../test/harness/layout-fixtures.js";
import type { OmNestedDiagram } from "./nested-diagram.component.js";
import type { NestedDiagramSource } from "./nested-diagram-source.js";
import type { NestingChangeDetail } from "./nested-ports.js";
import { NESTING_CHROME, NESTING_LATE_FADE_MS } from "./nesting-math.js";

const CLOSED = 100;
const PREFETCH = 50;
const MID = 6000 / 170;
const OPEN = 20;

afterEach(() => {
  vi.useRealTimers();
});

function blockClass(name: string, overrides: Partial<ClassDef> = {}): ClassDef {
  return {
    name,
    restriction: "block",
    iconLayers: [
      {
        from: name,
        shapes: [
          {
            kind: "rectangle",
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
        ],
      },
    ],
    connectors: {},
    parameters: {},
    ...overrides,
  };
}

const BOX: Placement = {
  extent: [
    [-10, -10],
    [10, 10],
  ],
};

function hostLayout(
  pidClass: ClassDef = blockClass("P.LimPID"),
): DiagramLayout {
  return {
    ...emptyLayout(),
    className: "P.Host",
    classes: { "P.LimPID": pidClass, "P.Gain": blockClass("P.Gain") },
    components: {
      pid: {
        name: "pid",
        classRef: "P.LimPID",
        placement: BOX,
        openable: true,
      },
      gain: {
        name: "gain",
        classRef: "P.Gain",
        placement: {
          extent: [
            [40, -10],
            [60, 10],
          ],
        },
      },
    },
  };
}

function limPidDiagram(): DiagramLayout {
  return {
    ...emptyLayout(),
    className: "P.LimPID",
    classes: { "P.Add": blockClass("P.Add") },
    components: {
      addP: {
        name: "addP",
        classRef: "P.Add",
        placement: {
          extent: [
            [-50, -10],
            [-30, 10],
          ],
        },
      },
      addI: {
        name: "addI",
        classRef: "P.Add",
        placement: {
          extent: [
            [30, -10],
            [50, 10],
          ],
        },
      },
    },
    connections: [
      {
        lhs: { component: "addP", port: "y" },
        rhs: { component: "addI", port: "u" },
        waypoints: [
          [-30, 0],
          [30, 0],
        ],
      },
    ],
  };
}

async function mountWithSource(
  source: NestedDiagramSource,
  layout = hostLayout(),
): Promise<OmGraphicalLayout> {
  const el = await mountLayout({ layout });
  // Let the first-layout auto-fit land before any test zoom overrides it.
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => setTimeout(r, 0));
  // Animation frames advance only on `runFrames`, so a late fade can be caught mid-way.
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame"],
  });
  el.nestedDiagramSource = source;
  await el.updateComplete;
  return el;
}

function scene(el: OmGraphicalLayout): OmScene {
  const found = el.shadowRoot?.querySelector("om-scene");
  if (!found) throw new Error("no om-scene");
  return found;
}

async function zoomTo(el: OmGraphicalLayout, zoom: number): Promise<void> {
  const view = scene(el);
  view.panX = 0;
  view.panY = 0;
  view.zoom = zoom;
  await view.updateComplete;
  await settle(el);
}

/** Zooms in through the prefetch size, so the diagram is at hand before the box opens. */
async function growTo(el: OmGraphicalLayout, zoom: number): Promise<void> {
  await zoomTo(el, PREFETCH);
  await zoomTo(el, zoom);
}

async function runFrames(el: OmGraphicalLayout, ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await settle(el);
}

/** Three turns: view update, fetch resolution, nested render. */
async function settle(el: OmGraphicalLayout): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    const comp = component(el, "pid");
    await comp.updateComplete;
    await nested(el)?.updateComplete;
  }
}

function component(el: OmGraphicalLayout, id: string): OmComponent {
  const found = Array.from(
    el.shadowRoot?.querySelectorAll("om-component") ?? [],
  ).find((c) => c.nodeId === id);
  if (!found) throw new Error(`no om-component ${id}`);
  return found;
}

function nested(el: OmGraphicalLayout, id = "pid"): OmNestedDiagram | null {
  return (
    component(el, id).shadowRoot?.querySelector("om-nested-diagram") ?? null
  );
}

function iconGroup(el: OmGraphicalLayout): OmLayerGroup {
  const g = component(el, "pid").shadowRoot?.querySelector("om-layer-group");
  if (!g) throw new Error("no icon layer group");
  return g;
}

/** The nested content's scale in host diagram units, per axis. */
function onScreenContentScale(el: OmGraphicalLayout): { x: number; y: number } {
  const view = nested(el);
  const content = view?.contentContainer;
  const placed = view?.container?.parent;
  if (!content || !placed) throw new Error("expected an opened box");
  return {
    x: content.scale.x * placed.scale.x,
    y: content.scale.y * placed.scale.y,
  };
}

function frame(el: OmGraphicalLayout): { space: Container; g: Graphics } {
  const space = nested(el)?.container?.getChildByLabel("nested-frame-space");
  const g = space?.getChildByLabel("nested-frame");
  if (!space || !(g instanceof Graphics)) throw new Error("expected a frame");
  return { space, g };
}

function strokeStyle(g: Graphics): { width?: number; alpha?: number } {
  const stroke = (
    g.context.instructions as ReadonlyArray<{
      action: string;
      data: { style: { width?: number; alpha?: number } };
    }>
  ).find((i) => i.action === "stroke");
  return stroke?.data.style ?? {};
}

function strokeWidth(g: Graphics): number {
  return strokeStyle(g).width ?? Number.NaN;
}

/** The frame's stroke as drawn on screen, in CSS px. */
function onScreenStrokePx(el: OmGraphicalLayout): number {
  const ctx = scene(el).sceneContextValue;
  if (!ctx) throw new Error("expected a scene context");
  return strokeWidth(frame(el).g) / ctx.worldPerPixel();
}

function pidSource(): ReturnType<typeof vi.fn<NestedDiagramSource>> {
  return vi.fn<NestedDiagramSource>(() => Promise.resolve(limPidDiagram()));
}

describe("semantic in-place nesting", () => {
  it("asks for nothing while the box is below the prefetch size", async () => {
    const source = pidSource();
    const el = await mountWithSource(source);
    await zoomTo(el, CLOSED);
    expect(source).not.toHaveBeenCalled();
    expect(nested(el)).toBeNull();
  });

  it("fetches the component's class, and fades its diagram in over the icon", async () => {
    const source = pidSource();
    const el = await mountWithSource(source);
    await growTo(el, OPEN);
    expect(source).toHaveBeenCalledWith("P.LimPID");

    const view = nested(el);
    expect(view?.container?.alpha).toBe(1);
    expect(view?.container?.visible).toBe(true);
    expect(iconGroup(el).container?.alpha).toBe(0);
  });

  it("cross-fades icon and diagram as exact complements mid-band", async () => {
    const el = await mountWithSource(pidSource());
    await growTo(el, OPEN);
    await zoomTo(el, MID);
    expect(nested(el)?.container?.alpha).toBeCloseTo(0.5);
    expect(iconGroup(el).container?.alpha).toBeCloseTo(0.5);
  });

  it("retraces the fade when the zoom reverses, back to the bare icon", async () => {
    const el = await mountWithSource(pidSource());
    await growTo(el, OPEN);
    await zoomTo(el, MID);
    expect(nested(el)?.container?.alpha).toBeCloseTo(0.5);
    await zoomTo(el, CLOSED);
    expect(nested(el)).toBeNull();
    expect(iconGroup(el).container?.alpha).toBe(1);
    expect(iconGroup(el).container?.visible).toBe(true);
  });

  it("never opens a leaf component, however far it is zoomed", async () => {
    const source = pidSource();
    const el = await mountWithSource(source);
    await zoomTo(el, 0.5);
    expect(source).not.toHaveBeenCalledWith("P.Gain");
    expect(nested(el, "gain")).toBeNull();
    expect(
      component(el, "gain").shadowRoot?.querySelector("om-layer-group"),
    ).toBeNull();
  });

  it("letterboxes into a non-square icon with one on-screen scale on both axes", async () => {
    const wide = blockClass("P.LimPID", {
      coordinateSystem: {
        extent: [
          [-100, -50],
          [100, 50],
        ],
      },
    });
    const el = await mountWithSource(pidSource(), hostLayout(wide));
    await growTo(el, OPEN);
    const { x, y } = onScreenContentScale(el);
    expect(x).toBeCloseTo(y);
    // The 20-unit box holds the 200-unit diagram: 0.1 diagram units per unit.
    expect(x).toBeCloseTo(0.1);
  });

  it("stays unstretched in a non-square placement of a square icon", async () => {
    const layout = hostLayout();
    const pid = layout.components["pid"];
    if (!pid) throw new Error("fixture has no pid");
    pid.placement = {
      extent: [
        [-20, -10],
        [20, 10],
      ],
    };
    const el = await mountWithSource(pidSource(), layout);
    await growTo(el, OPEN);
    const { x, y } = onScreenContentScale(el);
    expect(x).toBeCloseTo(y);
    expect(y).toBeCloseTo(0.1);
  });

  it("does not mirror the class diagram inside a flipped placement", async () => {
    const layout = hostLayout();
    const pid = layout.components["pid"];
    if (!pid) throw new Error("fixture has no pid");
    pid.placement = {
      extent: [
        [10, -10],
        [-10, 10],
      ],
    };
    const el = await mountWithSource(pidSource(), layout);
    await growTo(el, OPEN);
    const { x, y } = onScreenContentScale(el);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
  });

  it("draws the frame undistorted by a non-square placement, apart from the content", async () => {
    const layout = hostLayout();
    const pid = layout.components["pid"];
    if (!pid) throw new Error("fixture has no pid");
    pid.placement = {
      extent: [
        [-20, -10],
        [20, 10],
      ],
    };
    const el = await mountWithSource(pidSource(), layout);
    await growTo(el, OPEN);
    const placed = nested(el)?.container?.parent;
    if (!placed) throw new Error("expected an opened box");
    const { space } = frame(el);

    expect(space.scale.x * placed.scale.x).toBeCloseTo(1);
    expect(space.scale.y * placed.scale.y).toBeCloseTo(1);
    expect(
      nested(el)?.contentContainer?.getChildByLabel("nested-frame", true),
    ).toBe(null);
  });

  it("keeps the frame's on-screen stroke constant as zoom continues past fully open", async () => {
    const el = await mountWithSource(pidSource());
    await growTo(el, OPEN);
    expect(onScreenStrokePx(el)).toBeCloseTo(NESTING_CHROME.strokeWidthPx);
    await zoomTo(el, OPEN / 10);
    expect(onScreenStrokePx(el)).toBeCloseTo(NESTING_CHROME.strokeWidthPx);
  });

  it("draws the frame stroke translucent, yet more visible than its fill", async () => {
    const el = await mountWithSource(pidSource());
    await growTo(el, OPEN);
    const alpha = strokeStyle(frame(el).g).alpha ?? Number.NaN;
    expect(alpha).toBe(NESTING_CHROME.strokeAlpha);
    expect(alpha).toBeLessThan(1);
    expect(alpha).toBeGreaterThan(NESTING_CHROME.fillOpacity);
  });

  it("names the opened box by its class, not by the instance", async () => {
    const el = await mountWithSource(pidSource());
    await growTo(el, OPEN);
    expect(nested(el)?.label).toBe("P.LimPID");
  });

  it("renders the nested entities but keeps every one of them unpickable", async () => {
    const el = await mountWithSource(pidSource());
    await growTo(el, OPEN);
    const view = nested(el);
    const inner = Array.from(
      view?.shadowRoot?.querySelectorAll("om-component") ?? [],
    ).map((c) => c.nodeId);
    expect(inner).toEqual(["addP", "addI"]);
    expect(view?.container?.eventMode).toBe("none");
    expect(view?.container?.interactiveChildren).toBe(false);

    // A pick on nested addP's on-screen spot still lands on the host's `pid`.
    const ctx = scene(el).sceneContextValue;
    if (!ctx) throw new Error("expected a scene context");
    const addPx = 400 + (-4 * 600) / (2 * OPEN);
    const hit = ctx.pick(addPx, 300);
    expect(hit && entityKeyForNode(hit)).toEqual({
      kind: "component",
      nodeId: "pid",
    });
  });

  it("keeps the host's hover off a nested connection sharing its index", async () => {
    const el = await mountWithSource(pidSource());
    await growTo(el, OPEN);
    // Set directly: the host fixture has no edge 0 to hover.
    const store: unknown = Reflect.get(el, "interactionStore");
    const next: unknown = store && Reflect.get(store, "next");
    if (typeof next !== "function") throw new Error("no interaction store");
    next.call(store, { hoverKey: "edge:0" });
    const conn = nested(el)?.shadowRoot?.querySelector("om-connection");
    await conn?.updateComplete;
    expect(conn).toBeTruthy();
    expect(conn?.isHovered).toBe(false);
  });

  it("stays an icon when the fetch fails, and asks again only once the box drops below the prefetch size", async () => {
    const source = vi
      .fn<NestedDiagramSource>()
      .mockRejectedValueOnce(new Error("OMC busy"))
      .mockResolvedValue(limPidDiagram());
    const el = await mountWithSource(source);
    await growTo(el, OPEN);
    expect(nested(el)).toBeNull();
    expect(iconGroup(el).container?.alpha).toBe(1);

    // Zooming anywhere above the prefetch size, closed or open, does not retry.
    await zoomTo(el, MID);
    await zoomTo(el, PREFETCH);
    await zoomTo(el, OPEN);
    expect(source).toHaveBeenCalledTimes(1);

    await zoomTo(el, CLOSED);
    await growTo(el, OPEN);
    expect(source).toHaveBeenCalledTimes(2);
    expect(nested(el)?.container?.alpha).toBe(1);
  });

  it("fetches a second-keyed instance by its class name, not its catalog key", async () => {
    const base = hostLayout();
    const layout: DiagramLayout = {
      ...base,
      classes: {
        ...base.classes,
        "P.Gain#2": blockClass("P.Gain"),
      },
      components: {
        ...base.components,
        pid: {
          name: "pid",
          classRef: "P.Gain#2",
          placement: BOX,
          openable: true,
        },
      },
    };
    const source = vi.fn<NestedDiagramSource>((className) =>
      Promise.resolve({ ...limPidDiagram(), className }),
    );
    const el = await mountWithSource(source, layout);
    await growTo(el, OPEN);
    expect(source).toHaveBeenCalledWith("P.Gain");
    expect(source).not.toHaveBeenCalledWith("P.Gain#2");
    expect(nested(el)?.label).toBe("P.Gain");
  });
});

describe("semantic in-place nesting: a changed class", () => {
  function innerIds(el: OmGraphicalLayout): string[] {
    return Array.from(
      nested(el)?.shadowRoot?.querySelectorAll("om-component") ?? [],
    ).map((c) => c.nodeId);
  }

  function revisedDiagram(): DiagramLayout {
    const diagram = limPidDiagram();
    const { addP } = diagram.components;
    if (!addP) throw new Error("fixture has no addP");
    return { ...diagram, components: { addP }, connections: [] };
  }

  /** A source whose first call answers `first` and whose later calls wait. */
  function heldAfterFirst(first: DiagramLayout = limPidDiagram()): {
    source: ReturnType<typeof vi.fn<NestedDiagramSource>>;
    release: (layout: DiagramLayout) => void;
  } {
    let release: (layout: DiagramLayout) => void = () => {};
    const held = new Promise<DiagramLayout>((resolve) => {
      release = resolve;
    });
    const source = vi
      .fn<NestedDiagramSource>()
      .mockResolvedValueOnce(first)
      .mockReturnValue(held);
    return { source, release: (layout) => release(layout) };
  }

  it("re-fetches an open box drawing the class, keeping the old diagram up meanwhile", async () => {
    const { source, release } = heldAfterFirst();
    const el = await mountWithSource(source);
    await growTo(el, OPEN);

    el.invalidateNestedDiagrams("P.Add");
    await settle(el);
    expect(source).toHaveBeenCalledTimes(2);
    expect(innerIds(el)).toEqual(["addP", "addI"]);
    expect(iconGroup(el).container?.alpha).toBe(0);

    release(revisedDiagram());
    await settle(el);
    expect(innerIds(el)).toEqual(["addP"]);
    expect(iconGroup(el).container?.alpha).toBe(0);
  });

  it("re-fetches a closed box still above the prefetch size, so it reopens on the fresh diagram", async () => {
    const { source, release } = heldAfterFirst();
    const el = await mountWithSource(source);
    await growTo(el, OPEN);
    await zoomTo(el, PREFETCH);

    el.invalidateNestedDiagrams("P.LimPID");
    await settle(el);
    expect(source).toHaveBeenCalledTimes(2);

    release(revisedDiagram());
    await settle(el);
    await zoomTo(el, MID);
    expect(innerIds(el)).toEqual(["addP"]);
    expect(nested(el)?.container?.alpha).toBeCloseTo(0.5);
  });

  it("re-fetches every open box for a change no class name describes", async () => {
    const { source, release } = heldAfterFirst();
    const el = await mountWithSource(source);
    await growTo(el, OPEN);

    el.invalidateNestedDiagrams(null);
    release(revisedDiagram());
    await settle(el);

    expect(source).toHaveBeenCalledTimes(2);
    expect(innerIds(el)).toEqual(["addP"]);
  });

  it("leaves an open box alone when a class it does not draw changes", async () => {
    const source = pidSource();
    const el = await mountWithSource(source);
    await growTo(el, OPEN);

    el.invalidateNestedDiagrams("P.Elsewhere");
    await settle(el);

    expect(source).toHaveBeenCalledTimes(1);
  });

  it("drops a closed box's diagram, so it reopens as the icon until the fresh one lands", async () => {
    const { source, release } = heldAfterFirst();
    const el = await mountWithSource(source);
    await growTo(el, OPEN);
    await zoomTo(el, CLOSED);

    el.invalidateNestedDiagrams("P.LimPID");
    await settle(el);
    expect(source).toHaveBeenCalledTimes(1);

    await zoomTo(el, OPEN);
    expect(source).toHaveBeenCalledTimes(2);
    expect(nested(el)).toBeNull();
    expect(iconGroup(el).container?.alpha).toBe(1);

    release(revisedDiagram());
    await settle(el);
    await runFrames(el, NESTING_LATE_FADE_MS);
    expect(innerIds(el)).toEqual(["addP"]);
  });

  it("serves the fresh diagram when the class changes while its fetch is in flight", async () => {
    let resolveStale: (layout: DiagramLayout) => void = () => {};
    const source = vi
      .fn<NestedDiagramSource>()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
      )
      .mockResolvedValue(revisedDiagram());
    const el = await mountWithSource(source);
    await growTo(el, OPEN);

    el.invalidateNestedDiagrams("P.Add");
    resolveStale(limPidDiagram());
    await settle(el);
    await settle(el);
    await runFrames(el, NESTING_LATE_FADE_MS);

    expect(source).toHaveBeenCalledTimes(2);
    expect(innerIds(el)).toEqual(["addP"]);
  });

  it("does not restart a fetch in flight when an unrelated class changes", async () => {
    let resolve: (layout: DiagramLayout) => void = () => {};
    const source = vi.fn<NestedDiagramSource>().mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const el = await mountWithSource(source);
    await growTo(el, OPEN);

    el.invalidateNestedDiagrams("P.Host");
    resolve(limPidDiagram());
    await settle(el);
    await runFrames(el, NESTING_LATE_FADE_MS);

    expect(source).toHaveBeenCalledTimes(1);
    expect(innerIds(el)).toEqual(["addP", "addI"]);
  });

  it("fetches the new class when an open box's class changes under it", async () => {
    const source = vi.fn<NestedDiagramSource>((className) =>
      Promise.resolve({ ...limPidDiagram(), className }),
    );
    const el = await mountWithSource(source);
    await growTo(el, OPEN);

    component(el, "pid").nestedClass = "P.Gain";
    await settle(el);
    await runFrames(el, NESTING_LATE_FADE_MS);

    expect(source).toHaveBeenLastCalledWith("P.Gain");
    expect(nested(el)?.label).toBe("P.Gain");
  });
});

describe("semantic in-place nesting: prefetch and late fade", () => {
  /** A source whose answer waits for `release`. */
  function held(): {
    source: ReturnType<typeof vi.fn<NestedDiagramSource>>;
    release: () => void;
  } {
    let release: () => void = () => {};
    const pending = new Promise<DiagramLayout>((resolve) => {
      release = () => resolve(limPidDiagram());
    });
    const source = vi.fn<NestedDiagramSource>(() => pending);
    return { source, release: () => release() };
  }

  function announced(el: OmGraphicalLayout): (number | null)[] {
    const progress: (number | null)[] = [];
    component(el, "pid").addEventListener("om-nesting-change", (e) => {
      if (e instanceof CustomEvent) {
        const { view } = e.detail as NestingChangeDetail;
        progress.push(view?.progress ?? null);
      }
    });
    return progress;
  }

  it("fetches the diagram while the box is still an icon, growing toward the band", async () => {
    const source = pidSource();
    const el = await mountWithSource(source);
    const progress = announced(el);
    await zoomTo(el, PREFETCH);
    expect(source).toHaveBeenCalledWith("P.LimPID");
    expect(nested(el)).toBeNull();
    expect(iconGroup(el).container?.alpha).toBe(1);
    expect(progress.every((p) => p === null)).toBe(true);
  });

  it("opens a prefetched diagram at the size-driven fraction straight away", async () => {
    const el = await mountWithSource(pidSource());
    await zoomTo(el, PREFETCH);
    await zoomTo(el, MID);
    expect(nested(el)?.container?.alpha).toBeCloseTo(0.5);
    expect(iconGroup(el).container?.alpha).toBeCloseTo(0.5);
  });

  it("keeps a diagram that lands after the box zoomed away, and shows it on return without asking again", async () => {
    const { source, release } = held();
    const el = await mountWithSource(source);
    await zoomTo(el, OPEN);
    await zoomTo(el, CLOSED);
    release();
    await settle(el);
    expect(nested(el)).toBeNull();

    await zoomTo(el, OPEN);
    expect(source).toHaveBeenCalledTimes(1);
    expect(nested(el)?.container?.alpha).toBe(1);
    expect(iconGroup(el).container?.alpha).toBe(0);
  });

  it("fades in a diagram that lands after the box has opened, rather than popping it in", async () => {
    const { source, release } = held();
    const el = await mountWithSource(source);
    await zoomTo(el, OPEN);
    const progress = announced(el);
    release();
    await settle(el);
    expect(nested(el)?.container?.alpha ?? 0).toBe(0);
    expect(iconGroup(el).container?.alpha).toBe(1);

    await runFrames(el, NESTING_LATE_FADE_MS / 2);
    const mid = nested(el)?.container?.alpha ?? Number.NaN;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(iconGroup(el).container?.alpha).toBeCloseTo(1 - mid);
    expect(progress.at(-1)).toBeCloseTo(mid);

    await runFrames(el, NESTING_LATE_FADE_MS);
    expect(nested(el)?.container?.alpha).toBe(1);
    expect(iconGroup(el).container?.alpha).toBe(0);
    expect(progress.at(-1)).toBe(1);
    const shown = progress.filter((p): p is number => p !== null);
    expect(shown).toEqual([...shown].sort((a, b) => a - b));
  });

  it("fades a late diagram up to the size-driven fraction, not past it", async () => {
    const { source, release } = held();
    const el = await mountWithSource(source);
    await zoomTo(el, MID);
    release();
    await settle(el);

    await runFrames(el, NESTING_LATE_FADE_MS / 2);
    expect(nested(el)?.container?.alpha).toBeLessThan(0.4);

    await runFrames(el, NESTING_LATE_FADE_MS);
    expect(nested(el)?.container?.alpha).toBeCloseTo(0.5);
    expect(iconGroup(el).container?.alpha).toBeCloseTo(0.5);
  });

  it("stops a late fade once the component leaves the scene", async () => {
    const { source, release } = held();
    const el = await mountWithSource(source);
    await zoomTo(el, OPEN);
    release();
    await settle(el);
    await runFrames(el, NESTING_LATE_FADE_MS / 4);

    const comp = component(el, "pid");
    const progress = announced(el);
    comp.remove();
    vi.advanceTimersByTime(NESTING_LATE_FADE_MS / 4);
    await new Promise((r) => setTimeout(r, 0));
    await comp.updateComplete;
    const fading = progress.filter((p) => p !== null && p > 0 && p < 1);
    expect(fading).toEqual([]);
  });
});

describe("semantic in-place nesting: parent wires", () => {
  const PORT_U: PortDef = {
    name: "u",
    typeName: "P.RealInput",
    placement: {
      extent: [
        [-110, -10],
        [-90, 10],
      ],
    },
    iconLayers: [],
    from: "P.LimPID",
  };

  /** `src` at (-50, 0) wired to `pid.u`, which the icon puts at (-10, 0). */
  function wiredHost(waypoints: Point[]): DiagramLayout {
    const layout = hostLayout(
      blockClass("P.LimPID", { connectors: { u: PORT_U } }),
    );
    return {
      ...layout,
      classes: { ...layout.classes, "P.RealInput": blockClass("P.RealInput") },
      connectors: {
        src: {
          name: "src",
          classRef: "P.RealInput",
          placement: {
            extent: [
              [-52, -2],
              [-48, 2],
            ],
          },
        },
      },
      connections: [
        {
          lhs: { component: undefined, port: "src" },
          rhs: { component: "pid", port: "u" },
          waypoints,
        },
      ],
    };
  }

  /** LimPID's own diagram, drawing `u` at `(-100, y)`. */
  function drawingUAt(y: number): NestedDiagramSource {
    return (className) =>
      Promise.resolve({
        ...limPidDiagram(),
        className,
        connectors: {
          u: {
            name: "u",
            classRef: "P.RealInput",
            placement: {
              extent: [
                [-110, y - 10],
                [-90, y + 10],
              ],
            },
          },
        },
      });
  }

  function wire(el: OmGraphicalLayout): OmConnection {
    const found = el.shadowRoot?.querySelector("om-connection");
    if (!found) throw new Error("no om-connection");
    return found;
  }

  const AUTHORED: Point[] = [
    [-50, 0],
    [-10, 0],
  ];

  it("meets the port where the open box draws it, and leaves the layout's route alone", async () => {
    const layout = wiredHost(AUTHORED);
    const before = JSON.stringify(layout.connections);
    const el = await mountWithSource(drawingUAt(40), layout);
    await growTo(el, OPEN);
    await el.updateComplete;
    const end = wire(el).path.at(-1);
    expect(end?.[0]).toBeCloseTo(-10);
    expect(end?.[1]).toBeCloseTo(4);
    expect(wire(el).path[0]).toEqual([-50, 0]);
    expect(JSON.stringify(el.layout?.connections)).toBe(before);

    await zoomTo(el, CLOSED);
    await el.updateComplete;
    expect(wire(el).path).toEqual(AUTHORED);
  });

  it("meets the port of a box whose class is cataloged under a second key", async () => {
    const base = wiredHost(AUTHORED);
    const { "P.LimPID": limPid, ...others } = base.classes;
    const pid = base.components["pid"];
    if (!limPid || !pid) throw new Error("fixture has no pid");
    const layout: DiagramLayout = {
      ...base,
      classes: { ...others, "P.LimPID#2": limPid },
      components: {
        ...base.components,
        pid: { ...pid, classRef: "P.LimPID#2" },
      },
    };
    const el = await mountWithSource(drawingUAt(40), layout);
    await growTo(el, OPEN);
    await el.updateComplete;
    expect(wire(el).path.at(-1)?.[1]).toBeCloseTo(4);
  });

  it("moves the end as far as the box has faded in", async () => {
    const el = await mountWithSource(drawingUAt(40), wiredHost(AUTHORED));
    await growTo(el, OPEN);
    await zoomTo(el, MID);
    await el.updateComplete;
    expect(wire(el).path.at(-1)?.[1]).toBeCloseTo(2);
  });

  it("forgets a box removed while open, so its re-added component starts closed", async () => {
    const layout = wiredHost(AUTHORED);
    const el = await mountWithSource(drawingUAt(40), layout);
    await growTo(el, OPEN);
    const { pid: _removed, ...rest } = layout.components;
    el.layout = { ...layout, components: rest, connections: [] };
    await el.updateComplete;
    scene(el).zoom = CLOSED;
    await scene(el).updateComplete;
    el.layout = layout;
    await el.updateComplete;
    await settle(el);
    expect(wire(el).path).toEqual(AUTHORED);
  });
});
