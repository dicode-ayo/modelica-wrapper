/**
 * Per-scene render scheduler. Implements the "on-demand rendering"
 * strategy: the Babylon engine is NOT driven by a continuous render
 * loop — instead, every code path that mutates scene state calls
 * `requestSceneRender(scene)`, which schedules a single `scene.render()`
 * on the next animation frame and coalesces further requests until that
 * frame fires.
 *
 * Why: under software-rendered WebGL (Linux/VSCode with hardware
 * acceleration off) a continuous 60 Hz loop burns the entire CPU budget
 * on redrawing an unchanging scene. With on-demand rendering, an idle
 * diagram costs 0 frames/sec; interactive frames are produced only
 * during pan, zoom, drag, selection, texture-load, etc.
 *
 * Lifecycle: `OmScene.mount` registers a scheduler against the Babylon
 * `Scene` it creates; `OmScene.unmount` unregisters. Mutation sites
 * (shape-node, selection-overlay, edge, label, ...) call
 * `requestSceneRender(scene)` after touching Babylon state. The call is
 * a safe no-op when no scheduler is registered (e.g. headless tests
 * that build a `Scene` directly without going through `OmScene`).
 */

import type { Scene } from "@babylonjs/core";

/**
 * Drives the actual `scene.render()` call. `OmScene` provides this
 * function so we don't take a hard dependency on the Babylon Scene
 * type at the scheduler layer.
 */
type Renderer = () => void;

interface Scheduler {
  render: Renderer;
  pendingId: number;
}

const schedulers = new WeakMap<Scene, Scheduler>();

/**
 * Register a render function for a scene. Called by `OmScene.mount`.
 * Replacing an existing registration cancels any pending frame from
 * the prior entry — guards against rapid re-mounts (hot reload).
 */
export function registerRenderScheduler(scene: Scene, render: Renderer): void {
  const existing = schedulers.get(scene);
  if (existing && existing.pendingId) {
    cancelAnimationFrame(existing.pendingId);
  }
  schedulers.set(scene, { render, pendingId: 0 });
}

/** Tear down the scheduler. Called by `OmScene.unmount`. */
export function unregisterRenderScheduler(scene: Scene): void {
  const s = schedulers.get(scene);
  if (s && s.pendingId) {
    cancelAnimationFrame(s.pendingId);
  }
  schedulers.delete(scene);
}

/**
 * Request a render for `scene`. Coalesces: if a frame is already
 * scheduled, this is a no-op. No-op when no scheduler is registered
 * (headless tests, post-teardown).
 */
export function requestSceneRender(scene: Scene): void {
  const s = schedulers.get(scene);
  if (!s || s.pendingId) {
    return;
  }
  s.pendingId = requestAnimationFrame(() => {
    s.pendingId = 0;
    s.render();
  });
}
