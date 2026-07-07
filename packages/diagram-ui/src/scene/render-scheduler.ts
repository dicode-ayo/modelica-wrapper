/**
 * Per-scene render scheduler. Implements the "on-demand rendering"
 * strategy: the Pixi renderer is NOT driven by a continuous ticker —
 * instead, every code path that mutates scene state calls
 * `requestSceneRender(root)`, which schedules a single render on the
 * next animation frame and coalesces further requests until that frame
 * fires.
 *
 * Why: under software-rendered WebGL (Linux/VSCode with hardware
 * acceleration off) a continuous 60 Hz loop burns the entire CPU budget
 * on redrawing an unchanging scene. With on-demand rendering, an idle
 * diagram costs 0 frames/sec; interactive frames are produced only
 * during pan, zoom, drag, selection, texture-load, etc.
 *
 * The scheduler is keyed by an opaque render-root token (the stage
 * `Container`) so it takes no dependency on the renderer type. The
 * call is a safe no-op when no scheduler is registered (e.g. headless
 * tests that build the scene graph without a GPU renderer).
 */

/** Opaque per-scene token the scheduler is keyed by (the stage container). */
export type RenderRoot = object;

/** Drives the actual render call. `OmScene` provides this function. */
type Renderer = () => void;

interface Scheduler {
  render: Renderer;
  pendingId: number;
}

const schedulers = new WeakMap<RenderRoot, Scheduler>();

/**
 * Register a render function for a scene. Called by `OmScene.mount`.
 * Replacing an existing registration cancels any pending frame from
 * the prior entry — guards against rapid re-mounts (hot reload).
 */
export function registerRenderScheduler(
  root: RenderRoot,
  render: Renderer,
): void {
  const existing = schedulers.get(root);
  if (existing && existing.pendingId) {
    cancelAnimationFrame(existing.pendingId);
  }
  schedulers.set(root, { render, pendingId: 0 });
}

/** Tear down the scheduler. Called by `OmScene.unmount`. */
export function unregisterRenderScheduler(root: RenderRoot): void {
  const s = schedulers.get(root);
  if (s && s.pendingId) {
    cancelAnimationFrame(s.pendingId);
  }
  schedulers.delete(root);
}

/**
 * Request a render for `root`. Coalesces: if a frame is already
 * scheduled, this is a no-op. No-op when no scheduler is registered
 * (headless tests, post-teardown).
 */
export function requestSceneRender(root: RenderRoot): void {
  const s = schedulers.get(root);
  if (!s || s.pendingId) {
    return;
  }
  s.pendingId = requestAnimationFrame(() => {
    s.pendingId = 0;
    s.render();
  });
}
