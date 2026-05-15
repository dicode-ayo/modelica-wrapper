/**
 * `<om-perf-hud>` — togglable corner overlay showing live Babylon engine
 * stats. Mount inside `<om-graphical-layout>` (or `<om-scene>`) and set
 * the `show` attribute to enable.
 *
 * Stats sampled per animation frame:
 *   - FPS              (`engine.getFps()` — smoothed)
 *   - frame time (ms)  (1000 / fps)
 *   - active meshes    (`scene.getActiveMeshes().length`)
 *   - draw calls       (`engine.drawCalls` if exposed by the build)
 *
 * The HUD itself paints into a fixed-position div in the host's light DOM
 * — no canvas, no extra Babylon work, so it can't perturb the numbers it
 * is measuring.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { consume } from "@lit/context";

import { sceneContext, type SceneContext } from "../scene/scene-context.js";

type PerfStats = {
  fps: number;
  frameMs: number;
  meshes: number;
  drawCalls: number;
};

@customElement("om-perf-hud")
export class OmPerfHud extends LitElement {
  static override styles = css`
    :host {
      position: absolute;
      top: 8px;
      left: 8px;
      z-index: 9999;
      pointer-events: none;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.35;
      color: #d4f5d4;
      background: rgba(0, 0, 0, 0.65);
      padding: 4px 8px;
      border-radius: 4px;
      white-space: pre;
      user-select: none;
    }
    :host(:not([show])) {
      display: none;
    }
    .warn {
      color: #ffd27a;
    }
    .bad {
      color: #ff8585;
    }
  `;

  /** Toggle visibility from the host via attribute. */
  @property({ type: Boolean, reflect: true })
  show = false;

  @consume({ context: sceneContext, subscribe: true })
  private ctx: SceneContext | null = null;

  @state()
  private stats: PerfStats = { fps: 0, frameMs: 0, meshes: 0, drawCalls: 0 };

  private rafId = 0;
  private lastSampleAt = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    this.tick = this.tick.bind(this);
    this.rafId = requestAnimationFrame(this.tick);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.show) return nothing;
    const { fps, frameMs, meshes, drawCalls } = this.stats;
    // Colour FPS by health band so the eye catches drops quickly.
    const fpsClass = fps >= 55 ? "" : fps >= 30 ? "warn" : "bad";
    return html`<span class=${fpsClass}
        >${fps.toFixed(0).padStart(3)} fps</span
      >  ${frameMs.toFixed(1).padStart(4)} ms
meshes ${String(meshes).padStart(4)}   drawcalls ${String(drawCalls).padStart(4)}`;
  }

  private tick(): void {
    const now = performance.now();
    // Sample at ~10 Hz so the DOM doesn't repaint every frame and add
    // its own cost to what we're measuring.
    if (now - this.lastSampleAt >= 100) {
      this.lastSampleAt = now;
      const ctx = this.ctx;
      if (ctx) {
        const fps = ctx.engine.getFps();
        // `drawCalls` is a `PerfCounter` in recent Babylon builds; read
        // `.current` and fall back to 0 if the field isn't there.
        const dcField = (ctx.engine as unknown as { drawCalls?: unknown })
          .drawCalls;
        const drawCalls =
          typeof dcField === "number"
            ? dcField
            : (dcField as { current?: number } | undefined)?.current ?? 0;
        this.stats = {
          fps,
          frameMs: fps > 0 ? 1000 / fps : 0,
          meshes: ctx.scene.getActiveMeshes().length,
          drawCalls,
        };
      }
    }
    if (this.show) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.rafId = 0;
    }
  }

  override updated(changed: Map<string, unknown>): void {
    // Restart the rAF loop when the user flips `show` back on.
    if (changed.has("show") && this.show && !this.rafId) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-perf-hud": OmPerfHud;
  }
}
