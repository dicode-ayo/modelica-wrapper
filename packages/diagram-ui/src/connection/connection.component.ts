import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { ContextConsumer, consume } from "@lit/context";
import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  type Mesh,
  type TransformNode,
} from "@babylonjs/core";
import type { Point } from "@modelica-wrapper/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { setMeshHighlight } from "../base/selection-overlay.js";
import { requestSceneRender } from "../scene/render-scheduler.js";
import { pointsEqual } from "../interaction/connection-route.js";
import {
  interactionStateContext,
  type InteractionStateStore,
} from "../interaction/interaction-state.js";
import { isJunctionKey, parseKey } from "../interaction/node-keys.js";
import "./edge.component.js";

const JUNCTION_BASE_COLOR = new Color3(0.1, 0.1, 0.18);
const SELECTED_COLOR = new Color3(0.24, 0.51, 0.96); // blue-500, matches edges
/**
 * Resting opacity of junction discs — fully transparent so the route
 * reads as a clean polyline at rest. Babylon's picker ignores
 * `mesh.visibility`, so the discs stay pickable even at 0 — the user
 * can still grab a waypoint by clicking the corner of the orthogonal
 * route.
 */
const JUNCTION_IDLE_OPACITY = 0;
/** Opacity of the junction disc the cursor is currently over. */
const JUNCTION_HOVER_OPACITY = 1;

/**
 * `<om-connection>` — composes one `<om-edge>` with optional junction
 * markers at internal waypoints. Our `DiagramLayout` schema doesn't
 * model junctions explicitly (a connection has a single waypoint
 * list); we draw a small marker at each internal corner so a many-
 * segment connection reads as one routed line, not a polygon.
 *
 * Properties:
 *   - `path`             — `Point[]` of waypoints
 *   - `stroke`           — `#rrggbb` colour, forwarded to <om-edge>
 *   - `clocked`          — dashed pattern, forwarded
 *   - `showJunctions`    — render a dot at each internal waypoint
 *   - `selectedKeys`     — set of entity keys (`edge:<nodeId>` and
 *                          `junc:<nodeId>/<waypointIdx>`) that are
 *                          currently selected; drives the highlight
 *                          colour on the edge + HighlightLayer entry
 *                          on each junction.
 *
 * Endpoint dots (first / last) are deliberately NOT drawn — the
 * connectors at each end already provide the visual terminator.
 *
 * Junction metadata uses a compound nodeId of
 * `<connectionNodeId>/<waypointIndex>` so the interaction layer can
 * distinguish different junctions on the same connection.
 */
@customElement("om-connection")
export class OmConnection extends LitElement {
  static override styles = css`
    :host {
      display: none;
    }
  `;

  @property() nodeId = "";
  @property({ attribute: false }) path: Point[] = [];
  @property() stroke: string | undefined = undefined;
  @property({ type: Boolean }) clocked = false;
  @property({ type: Boolean, attribute: "show-junctions" })
  showJunctions = true;
  @property({ type: Number, attribute: "junction-radius" })
  junctionRadius = 1.5;
  @property({ attribute: false })
  selectedKeys: Set<string> = new Set();

  @consume({ context: parentNodeContext, subscribe: true })
  private parentTransform: TransformNode | null = null;

  /**
   * Hover tracking is self-managed: the host (`<om-graphical-layout>`)
   * publishes the current pointer-hover key into
   * `interactionStateContext`, and we subscribe directly. Doing the
   * matching here (instead of having the host walk every
   * `<om-connection>` and call setters) keeps the junction-id format
   * encapsulated inside the component that owns the discs.
   *
   * The consumer is registered in the constructor for its side effect
   * (the Lit ReactiveController binds itself to `this`); we only care
   * about the callback, which re-wires the store subscription each
   * time Lit hands us a new store reference (mount, hot reload).
   */
  private interactionUnsubscribe: (() => void) | null = null;

  private junctionMeshes: Mesh[] = [];
  private junctionMaterial: StandardMaterial | null = null;
  private highlightedJunctions = new Set<Mesh>();
  /**
   * Compound nodeId (`${connectionId}/${waypointIdx}`) of the junction
   * disc currently under the cursor, or `null` when none. The hovered
   * disc renders at full opacity; the rest stay at
   * `JUNCTION_IDLE_OPACITY` so the route reads as a clean polyline
   * with subtle waypoint hints.
   */
  private hoveredJunctionId: string | null = null;
  /**
   * Last waypoint list the junctions were built against. Compared by
   * content so a fresh-but-equal `path` (typical after an OMC layout
   * roundtrip) doesn't dispose + recreate the junction discs. Also
   * acts as the "first build" sentinel so we don't keep re-running
   * `rebuildJunctions()` every `updated()` when there are no internal
   * waypoints (empty `junctionMeshes`).
   */
  private builtPath: Point[] | null = null;

  constructor() {
    super();
    new ContextConsumer(this, {
      context: interactionStateContext,
      subscribe: true,
      callback: (store) => this.resubscribeInteractionState(store),
    });
  }

  /**
   * Attach to the host's interaction-state store and react to every
   * hover-key change by recomputing whether one of our junctions is
   * the current target. The store is a behaviour-subject so the
   * `subscribe()` callback fires once immediately with the current
   * snapshot — no race on mount.
   */
  private resubscribeInteractionState(
    store: InteractionStateStore | null,
  ): void {
    this.interactionUnsubscribe?.();
    this.interactionUnsubscribe = null;
    if (!store) return;
    this.interactionUnsubscribe = store.subscribe((snap) => {
      const hoveredId = this.resolveOwnHoveredJunction(snap.hoverKey);
      this.applyHoveredJunction(hoveredId);
    });
  }

  /**
   * Returns the compound junction nodeId (`${this.nodeId}/${idx}`) that
   * the host's hover key points at, IF the junction belongs to this
   * connection. Otherwise `null` — including when the hover key is
   * absent, malformed, or belongs to a different connection.
   */
  private resolveOwnHoveredJunction(hoverKey: string | null): string | null {
    if (!hoverKey) return null;
    const parsed = parseKey(hoverKey);
    if (!parsed || !isJunctionKey(parsed)) return null;
    // Junction nodeId is `${connId}/${waypointIdx}`. Match by prefix
    // rather than splitting+comparing, so a connId that itself
    // contains slashes (we don't generate those today but the parser
    // doesn't forbid them) still matches correctly.
    const prefix = `${this.nodeId}/`;
    return parsed.nodeId.startsWith(prefix) ? parsed.nodeId : null;
  }

  override render() {
    if (this.path.length < 2) {
      return html``;
    }
    return html`<om-edge
      nodeId=${`${this.nodeId}/edge`}
      .path=${this.path}
      .stroke=${this.stroke}
      ?clocked=${this.clocked}
      ?selected=${this.selectedKeys.has(`edge:${this.nodeId}`)}
    ></om-edge>`;
  }

  override updated(changed: Map<string, unknown>): void {
    const visualChanged =
      changed.has("stroke") ||
      changed.has("nodeId") ||
      changed.has("showJunctions") ||
      changed.has("junctionRadius");
    const pathChanged =
      changed.has("path") && !pointsEqual(this.path, this.builtPath);
    if (this.builtPath === null || visualChanged) {
      this.rebuildJunctions();
    } else if (pathChanged) {
      // Try in-place position update first. Disposing + recreating the
      // discs on every pointermove of a component drag (which shifts
      // the connection waypoints) is the visible "junction dot flicker".
      // Mutating the position of the existing disc keeps the GPU
      // resources stable. Falls back to a full rebuild if the internal-
      // waypoint count changed (the topology actually differs, not
      // just the coordinates).
      if (!this.updateJunctionPositions()) {
        this.rebuildJunctions();
      }
    }
    this.applyJunctionSelection();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.interactionUnsubscribe?.();
    this.interactionUnsubscribe = null;
    this.disposeJunctions();
  }

  /**
   * Reposition the existing junction discs against the current `path`,
   * without disposing and recreating them. Returns `false` if the
   * structure doesn't match (different internal-waypoint count, or the
   * meshes haven't been built yet) — the caller falls back to a full
   * rebuild in that case.
   */
  private updateJunctionPositions(): boolean {
    if (!this.parentTransform) {
      return false;
    }
    const internal = this.path.slice(1, -1);
    if (internal.length !== this.junctionMeshes.length) {
      return false;
    }
    for (let i = 0; i < internal.length; i++) {
      const [x, y] = internal[i]!;
      this.junctionMeshes[i]!.position.set(x, y, -0.01);
    }
    this.builtPath = this.path;
    requestSceneRender(this.parentTransform.getScene());
    return true;
  }

  private rebuildJunctions(): void {
    this.disposeJunctions();
    this.builtPath = this.path;
    if (!this.showJunctions || !this.parentTransform) {
      return;
    }
    const scene = this.parentTransform.getScene();
    const internal = this.path.slice(1, -1);
    if (internal.length === 0) {
      requestSceneRender(scene);
      return;
    }
    const stroke = this.stroke;
    this.junctionMaterial = new StandardMaterial("om-junction-mat", scene);
    this.junctionMaterial.disableLighting = true;
    this.junctionMaterial.emissiveColor =
      parseColor(stroke) ?? JUNCTION_BASE_COLOR;

    // Internal waypoints map to `path` indices 1 .. path.length - 2.
    let waypointIdx = 1;
    for (const [x, y] of internal) {
      const compoundId = `${this.nodeId}/${waypointIdx}`;
      const disc = MeshBuilder.CreateDisc(
        `om-junction:${compoundId}`,
        { radius: this.junctionRadius, tessellation: 16 },
        scene,
      );
      disc.material = this.junctionMaterial;
      disc.parent = this.parentTransform;
      // Negative z = closer to camera (sits at -Z) so the junction
      // dot paints on top of the edge line.
      disc.position.set(x, y, -0.01);
      disc.metadata = { kind: "junction", nodeId: compoundId };
      disc.isPickable = true;
      // Always visible at a subtle opacity; the hovered disc (matched
      // by `hoveredJunctionId`) renders at full opacity. Babylon's
      // picker ignores `mesh.visibility`, so translucent discs are
      // still grabbable for the connection-reshape gesture.
      disc.visibility =
        compoundId === this.hoveredJunctionId
          ? JUNCTION_HOVER_OPACITY
          : JUNCTION_IDLE_OPACITY;
      this.junctionMeshes.push(disc);
      waypointIdx++;
    }
    requestSceneRender(scene);
  }

  /**
   * Apply a junction-hover transition: the disc whose metadata nodeId
   * matches `id` renders at `JUNCTION_HOVER_OPACITY`, every other
   * disc reverts to `JUNCTION_IDLE_OPACITY`. Pass `null` to clear.
   * Idempotent — bailing on no-op spares us a pointless rAF.
   *
   * Called from the `interactionStateContext` subscription (see
   * `resubscribeInteractionState`); not part of the public API.
   */
  private applyHoveredJunction(id: string | null): void {
    if (this.hoveredJunctionId === id) {
      return;
    }
    this.hoveredJunctionId = id;
    for (const disc of this.junctionMeshes) {
      const meta = disc.metadata as { nodeId?: string } | null;
      disc.visibility =
        meta?.nodeId === id ? JUNCTION_HOVER_OPACITY : JUNCTION_IDLE_OPACITY;
    }
    const scene = this.parentTransform?.getScene();
    if (scene) {
      requestSceneRender(scene);
    }
  }

  /** Read-only access to the currently hovered junction id. Exposed
   *  for tests + future overlays that want a snapshot. */
  get hoveredJunction(): string | null {
    return this.hoveredJunctionId;
  }

  private applyJunctionSelection(): void {
    const parent = this.parentTransform;
    if (!parent) {
      return;
    }
    const scene = parent.getScene();
    // Remove highlights that no longer apply.
    for (const mesh of [...this.highlightedJunctions]) {
      const id = (mesh.metadata as { nodeId?: string } | null)?.nodeId;
      if (id && !this.selectedKeys.has(`junc:${id}`)) {
        setMeshHighlight(scene, mesh, null);
        this.highlightedJunctions.delete(mesh);
      }
    }
    // Add highlights for newly-selected junctions.
    for (const mesh of this.junctionMeshes) {
      const id = (mesh.metadata as { nodeId?: string } | null)?.nodeId;
      if (id && this.selectedKeys.has(`junc:${id}`)) {
        if (!this.highlightedJunctions.has(mesh)) {
          setMeshHighlight(scene, mesh, SELECTED_COLOR);
          this.highlightedJunctions.add(mesh);
        }
      }
    }
  }

  private disposeJunctions(): void {
    const parent = this.parentTransform;
    const scene = parent ? parent.getScene() : null;
    for (const m of this.junctionMeshes) {
      if (scene && this.highlightedJunctions.has(m)) {
        setMeshHighlight(scene, m, null);
      }
      m.dispose();
    }
    this.junctionMeshes = [];
    this.highlightedJunctions.clear();
    this.junctionMaterial?.dispose();
    this.junctionMaterial = null;
    // Clear the "built against" sentinel so a reconnect (or any next
    // `rebuildJunctions`) starts from a clean slate. `rebuildJunctions`
    // re-sets it immediately after calling us; the order is fine.
    this.builtPath = null;
  }

  get junctions(): Mesh[] {
    return this.junctionMeshes;
  }
}

function parseColor(input: string | undefined): Color3 | undefined {
  if (!input) {
    return undefined;
  }
  const m = input.match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) {
    return undefined;
  }
  const hex = m[1]!;
  return new Color3(
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "om-connection": OmConnection;
  }
}
