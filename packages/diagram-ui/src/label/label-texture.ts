import { AdvancedDynamicTexture } from "@babylonjs/gui";
import type { Scene } from "@babylonjs/core";

/**
 * Lazy per-scene `AdvancedDynamicTexture` reused by every `<om-label>`.
 *
 * Creating one texture per scene rather than per label keeps the GUI
 * draw call count flat as we add hundreds of labels. The texture is
 * stashed under `scene.metadata.omLabelTexture` (we don't subclass
 * Scene; the metadata bag is the standard escape hatch).
 *
 * Returns `null` on `NullEngine` (headless test contexts). Babylon's
 * AdvancedDynamicTexture schedules a debounced refresh that would
 * otherwise fire on a disposed render context and surface as an
 * unhandled exception in vitest. Headless tests still get a real
 * anchor TransformNode and the `currentText` getter on the label —
 * they just skip the actual GUI render.
 *
 * Disposed when the scene disposes.
 */
const SCENE_META_KEY = "omLabelTexture";

interface SceneMeta {
  [SCENE_META_KEY]?: AdvancedDynamicTexture | undefined;
}

/**
 * Resolves `AdvancedDynamicTexture.renderScale` so the fullscreen GUI
 * texture lands exactly on the device pixel grid — once.
 *
 * The texture rasterises at `engine.getRenderWidth() × renderScale`
 * pixels. `getRenderWidth()` already reports the physical backbuffer:
 * with `adaptToDeviceRatio: true` the engine's hardware-scaling level is
 * `1 / devicePixelRatio`, so the backbuffer is `CSS × devicePixelRatio`.
 * Target texture size is `CSS × devicePixelRatio`, hence
 *   renderScale = devicePixelRatio × hardwareScalingLevel
 * which collapses to `1` when `adaptToDeviceRatio` already applied DPR
 * and to `devicePixelRatio` when it did not. Multiplying the raw DPR in
 * unconditionally would compound it and supersample to DPR² area.
 *
 * Falls back to `1` for non-finite or non-positive readings (jsdom,
 * NullEngine, exotic embeddings) — a non-positive scale collapses the
 * texture.
 */
export function resolveRenderScale(
  devicePixelRatio: number | undefined,
  hardwareScalingLevel: number,
): number {
  if (
    devicePixelRatio === undefined ||
    !Number.isFinite(devicePixelRatio) ||
    devicePixelRatio <= 0 ||
    !Number.isFinite(hardwareScalingLevel) ||
    hardwareScalingLevel <= 0
  ) {
    return 1;
  }
  return devicePixelRatio * hardwareScalingLevel;
}

export function ensureLabelTexture(
  scene: Scene,
): AdvancedDynamicTexture | null {
  const engine = scene.getEngine();
  if (engine.constructor.name === "NullEngine") {
    return null;
  }
  const metadata = (scene.metadata as SceneMeta | null | undefined) ?? {};
  const existing = metadata[SCENE_META_KEY];
  if (existing) {
    return existing;
  }
  const tex = AdvancedDynamicTexture.CreateFullscreenUI(
    "om-label-ui",
    true,
    scene,
  );
  tex.renderScale = resolveRenderScale(
    typeof globalThis.devicePixelRatio === "number"
      ? globalThis.devicePixelRatio
      : undefined,
    engine.getHardwareScalingLevel(),
  );
  metadata[SCENE_META_KEY] = tex;
  scene.metadata = metadata;
  scene.onDisposeObservable.add(() => {
    tex.dispose();
    metadata[SCENE_META_KEY] = undefined;
  });
  return tex;
}
