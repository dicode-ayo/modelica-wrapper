/**
 * `<om-perf-hud>` — togglable corner overlay showing live renderer stats.
 * Mount inside `<om-graphical-layout>` (or `<om-scene>`) and set the
 * `show` attribute to enable.
 *
 * Stats sampled on a ~10 Hz timer off the HUD's own animation-frame loop:
 *   - FPS              (animation-frame cadence — drops visibly on jank)
 *   - frame time (ms)  (1000 / fps)
 *   - scene nodes      (containers under the stage)
 *
 * The HUD paints into a fixed-position div in the host's light DOM — no
 * canvas work, so it can't perturb the numbers it is measuring.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ContextConsumer, consume } from "@lit/context";
import type { Container } from "pixi.js";

import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import {
  viewStateContext,
  type ViewStateStore,
} from "../scene/view-state-store.js";
import { clientToDiagram } from "../scene/view-math.js";
import {
  interactionStateContext,
  type InteractionSnapshot,
  type InteractionState,
  type InteractionStateStore,
} from "../interaction/interaction-state.js";
import { parseKey, type EntityKind } from "../interaction/entity-keys.js";

type PerfStats = {
  fps: number;
  frameMs: number;
  nodes: number;
};

/** Pointer position in diagram (Modelica) coordinates, or null when
 *  the cursor is outside the canvas. */
type DiagramPoint = { x: number; y: number } | null;

/**
 * Pulls the GPU renderer string from `WEBGL_debug_renderer_info`. If
 * Chrome decided this page can't see it (privacy mode) we get the
 * unmasked vendor anyway — still enough to tell SwiftShader / software
 * fallback apart from "ANGLE (NVIDIA…)" or "Mesa Intel…".
 */
function readGpuRenderer(): string {
  try {
    const c = document.createElement("canvas");
    const gl =
      (c.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (c.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return "no-webgl";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) {
      const r = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      if (typeof r === "string" && r.length > 0) return r;
    }
    const v = gl.getParameter(gl.VENDOR);
    return typeof v === "string" ? v : "unknown";
  } catch {
    return "error";
  }
}

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
      user-select: none;
    }
    :host(:not([show])) {
      display: none;
    }
    .row {
      white-space: pre;
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

  @consume({ context: viewStateContext, subscribe: true })
  private viewStore: ViewStateStore | null = null;

  @state()
  private stats: PerfStats = { fps: 0, frameMs: 0, nodes: 0 };

  @state()
  private pointer: DiagramPoint = null;

  @state()
  private interaction: InteractionSnapshot = {
    state: { kind: "idle" },
    mode: "idle",
    hoverKey: null,
    selectedKeys: [],
    version: 0,
  };

  /** Captured once on connect — used to surface software-renderer fallbacks. */
  private gpu = "";

  private rafId = 0;
  private lastSampleAt = 0;
  /** Animation frames counted since the last stats sample (for FPS). */
  private frameCount = 0;
  /** Canvas the pointer listeners are bound to. Tracked so we can
   *  remove them cleanly even if the renderer's canvas later changes. */
  private pointerCanvas: HTMLCanvasElement | null = null;
  /** Unsubscribe from the interaction store; rebound when the context
   *  resolves to a new store (mount, scene teardown, hot reload). */
  private interactionUnsub: (() => void) | null = null;

  constructor() {
    super();
    // Behaviour-subject bridge: each new store hands us a snapshot
    // immediately on subscribe, so the HUD lights up with the current
    // state without waiting for the next user gesture.
    new ContextConsumer(this, {
      context: interactionStateContext,
      subscribe: true,
      callback: (store) => this.resubscribeInteraction(store),
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.tick = this.tick.bind(this);
    this.gpu = readGpuRenderer();

    console.info(`[om-perf-hud] webgl renderer = ${this.gpu}`);
    this.rafId = requestAnimationFrame(this.tick);
  }

  private resubscribeInteraction(store: InteractionStateStore | null): void {
    this.interactionUnsub?.();
    this.interactionUnsub = null;
    if (!store) {
      return;
    }
    this.interactionUnsub = store.subscribe((snap) => {
      this.interaction = snap;
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.detachPointerListeners();
    this.interactionUnsub?.();
    this.interactionUnsub = null;
  }

  override updated(changed: Map<string, unknown>): void {
    // Restart the rAF loop when the user flips `show` back on.
    if (changed.has("show") && this.show && !this.rafId) {
      this.rafId = requestAnimationFrame(this.tick);
    }
    // Pointer listeners need re-binding whenever the scene context
    // resolves (or changes) — the renderer canvas is null until OmScene
    // finishes mounting.
    this.attachPointerListeners();
  }

  /**
   * Bind `pointermove` / `pointerleave` to the active canvas so the
   * HUD can show diagram-space cursor coordinates. Idempotent: a
   * second call against the same canvas is a no-op.
   */
  private attachPointerListeners(): void {
    const view = this.ctx?.renderer?.canvas;
    const canvas = view instanceof HTMLCanvasElement ? view : null;
    if (canvas === this.pointerCanvas) return;
    this.detachPointerListeners();
    if (!canvas) return;
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.pointerCanvas = canvas;
  }

  private detachPointerListeners(): void {
    if (!this.pointerCanvas) return;
    this.pointerCanvas.removeEventListener("pointermove", this.onPointerMove);
    this.pointerCanvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.pointerCanvas = null;
  }

  private onPointerMove = (e: PointerEvent): void => {
    const canvas = this.pointerCanvas;
    const view = this.viewStore?.value;
    if (!canvas || !view) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const p = clientToDiagram(
      view,
      { width: rect.width, height: rect.height },
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    this.pointer = { x: p.x, y: p.y };
  };

  private onPointerLeave = (): void => {
    this.pointer = null;
  };

  override render(): TemplateResult | typeof nothing {
    if (!this.show) return nothing;
    const { fps, frameMs, nodes } = this.stats;
    // Colour FPS by health band so the eye catches drops quickly.
    const fpsClass = fps >= 55 ? "" : fps >= 30 ? "warn" : "bad";
    // "Software" / "SwiftShader" in the GPU string almost always means
    // GPU acceleration is disabled — that alone halves the FPS.
    const gpuClass = /software|swiftshader/i.test(this.gpu) ? "bad" : "";
    // Pointer line shows diagram-space (Modelica) coordinates. Renders
    // a placeholder when the cursor is outside the canvas so the HUD
    // height doesn't jitter on hover-out.
    const pointerStr = this.pointer
      ? `${this.pointer.x.toFixed(1).padStart(7)}, ${this.pointer.y
          .toFixed(1)
          .padStart(7)}`
      : "      —,       —";
    const stateLine = formatStateLine(this.interaction.state);
    const hoverLine = formatHoverLine(this.interaction.hoverKey);
    const selectionLine = formatSelectionLine(this.interaction.selectedKeys);
    const fpsTxt = `${fps.toFixed(0).padStart(3)} fps`;
    const msTxt = `${frameMs.toFixed(1).padStart(4)} ms`;
    const countsTxt = `nodes ${String(nodes).padStart(4)}`;
    // Padding lives in these strings, not in the template text — `.row` is
    // `white-space: pre`, so every space here is rendered verbatim while the
    // markup stays free of layout-significant whitespace.
    const lines: ReadonlyArray<{ cls: string; text: string }> = [
      { cls: fpsClass, text: `${fpsTxt}  ${msTxt}` },
      { cls: "", text: countsTxt },
      { cls: "", text: `${"xy".padEnd(7)}${pointerStr}` },
      { cls: "", text: `${"state".padEnd(7)}${stateLine}` },
      { cls: "", text: `${"hover".padEnd(7)}${hoverLine}` },
      { cls: "", text: `${"sel".padEnd(7)}${selectionLine}` },
      { cls: gpuClass, text: `gpu ${this.gpu}` },
    ];
    return html`${lines.map(
      (line) => html`<div class="row ${line.cls}">${line.text}</div>`,
    )}`;
  }

  private tick(): void {
    this.frameCount++;
    const now = performance.now();
    // Sample at ~10 Hz so the DOM doesn't repaint every frame and add
    // its own cost to what we're measuring.
    const elapsed = now - this.lastSampleAt;
    if (elapsed >= 100) {
      const fps = elapsed > 0 ? (this.frameCount * 1000) / elapsed : 0;
      this.frameCount = 0;
      this.lastSampleAt = now;
      const ctx = this.ctx;
      this.stats = {
        fps,
        frameMs: fps > 0 ? 1000 / fps : 0,
        nodes: ctx ? countNodes(ctx.stage) : 0,
      };
    }
    if (this.show) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.rafId = 0;
    }
  }
}

/** Total descendant containers under `root` (inclusive). */
function countNodes(root: Container): number {
  let n = 1;
  for (const child of root.children) {
    n += countNodes(child);
  }
  return n;
}

declare global {
  interface HTMLElementTagNameMap {
    "om-perf-hud": OmPerfHud;
  }
}

const ENTITY_LABEL: Record<EntityKind, string> = {
  component: "component",
  connector: "connector",
  shape: "shape",
  edge: "edge",
  junction: "junction",
  label: "label",
  port: "port",
  handle: "handle",
  "rotate-handle": "rotate-handle",
  "vertex-handle": "vertex-handle",
};

/** "moving 2 items" / "connecting c:R1.p → c:R2.in" / "idle" etc. */
function formatStateLine(state: InteractionState): string {
  switch (state.kind) {
    case "idle":
      return "idle";
    case "hovering":
      return `hovering ${state.key}`;
    case "moving":
      return state.keys.length === 1
        ? `moving ${state.keys[0]}`
        : `moving ${state.keys.length} items`;
    case "resizing":
      return `resizing ${state.key} (${state.corner})`;
    case "rotating":
      return `rotating ${state.key}`;
    case "selecting":
      return "selecting (rubber-band)";
    case "drawing":
      return "drawing";
    case "connecting":
      return `connecting ${state.fromKey} → ${state.toKey ?? "—"}`;
  }
}

/** "component R1" / "connector R1.p" / "—" */
function formatHoverLine(key: string | null): string {
  if (!key) return "—";
  const parsed = parseKey(key);
  if (!parsed) return key;
  return `${ENTITY_LABEL[parsed.kind] ?? parsed.kind} ${parsed.nodeId}`;
}

/** "—" / "c:R1" / "c:R1 (+2 more)" */
function formatSelectionLine(keys: readonly string[]): string {
  if (keys.length === 0) return "—";
  if (keys.length === 1) return keys[0] ?? "—";
  return `${keys[0]} (+${keys.length - 1} more)`;
}
