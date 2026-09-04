import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the backend allowlist the default renderer factory hands Pixi.
 *
 * `autoDetectRenderer` treats a *string* `preference` as "try this first,
 * then everything else in priority order" — so `'webgl'` alone resolves to
 * `['webgl', 'webgpu', 'canvas']` and reaches WebGPU on a host with no
 * usable WebGL context. Only the array form is an exact allowlist. These
 * assertions fail if the shape regresses to a string.
 */

const { autoDetectRendererSpy } = vi.hoisted(() => ({
  autoDetectRendererSpy: vi.fn(),
}));

vi.mock("pixi.js", async (importActual) => {
  const actual = await importActual<typeof import("pixi.js")>();
  return { ...actual, autoDetectRenderer: autoDetectRendererSpy };
});

await import("../src/scene/scene.component.js");
type OmScene = import("../src/scene/scene.component.js").OmScene;

let mounted: OmScene[] = [];

async function mountWithDefaultFactory(): Promise<void> {
  const el = document.createElement("om-scene") as OmScene;
  // No `rendererFactory` override: exercise `defaultRendererFactory`.
  document.body.appendChild(el);
  await el.updateComplete;
  // `initRenderer` awaits the factory, so let its first tick settle.
  await Promise.resolve();
  mounted.push(el);
}

afterEach(() => {
  for (const el of mounted) {
    el.remove();
  }
  mounted = [];
  autoDetectRendererSpy.mockClear();
});

function preferenceFromFirstCall(): unknown {
  const call = autoDetectRendererSpy.mock.calls[0];
  if (call === undefined) throw new Error("autoDetectRenderer was not called");
  const [options] = call as [{ preference?: unknown }];
  return options.preference;
}

describe("defaultRendererFactory backend preference", () => {
  it("allowlists WebGL then canvas, excluding WebGPU", async () => {
    await mountWithDefaultFactory();

    // Array-ness carries the invariant: a string here would silently
    // re-admit WebGPU as a fallback, so `not.toContain('webgpu')` on its
    // own would pass against the very regression this guards.
    expect(preferenceFromFirstCall()).toEqual(["webgl", "canvas"]);
  });
});
