import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ContextConsumer, consume } from "@lit/context";
import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  type Mesh,
  type TransformNode,
} from "@babylonjs/core";
import type { Point } from "@dicode/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { setMeshHighlight } from "../base/selection-overlay.js";
import { requestSceneRender } from "../scene/render-scheduler.js";
import { pointsEqual } from "../interaction/connection-route.js";
import {
  interactionStateContext,
  type InteractionState,
  type InteractionStateStore,
} from "../interaction/interaction-state.js";
import { isJunctionKey, parseKey } from "../interaction/node-keys.js";
import { WAYPOINT_RADIUS } from "./edge-build.js";
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
/** Opacity of every junction disc while the connection is hovered. */
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
  junctionRadius = WAYPOINT_RADIUS;
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
   * Whether the pointer is over any part of this connection (its edge
   * or one of its waypoint discs). While hovered the whole route
   * highlights as a unit: the edge reveals its band and every junction
   * disc lights up, so the user sees all the waypoints they can grab.
   */
  @state() private hovered = false;
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
   * hover-key change by recomputing whether the pointer is over this
   * connection. The store is a behaviour-subject so the `subscribe()`
   * callback fires once immediately with the current snapshot — no
   * race on mount.
   */
  private resubscribeInteractionState(
    store: InteractionStateStore | null,
  ): void {
    this.interactionUnsubscribe?.();
    this.interactionUnsubscribe = null;
    if (!store) return;
    this.interactionUnsubscribe = store.subscribe((snap) => {
      // Gate on the active drag target as well as the hover key: a
      // dragged route's geometry leaves the cursor each frame, so the
      // hover key alone would drop the highlight mid-drag.
      this.hovered =
        this.ownsKey(snap.hoverKey) || this.isDragTarget(snap.state);
    });
  }

  /**
   * Whether `key` targets this connection — either its edge
   * (`edge:${this.nodeId}`) or one of its junction discs
   * (`junc:${this.nodeId}/${idx}`). Matches the junction by prefix so a
   * connId containing slashes still resolves correctly.
   */
  private ownsKey(key: string | null): boolean {
    if (!key) return false;
    const parsed = parseKey(key);
    if (!parsed) return false;
    if (parsed.kind === "edge") return parsed.nodeId === this.nodeId;
    if (isJunctionKey(parsed)) {
      return parsed.nodeId.startsWith(`${this.nodeId}/`);
    }
    return false;
  }

  /** Whether the in-flight move drag targets this connection's edge or
   *  one of its junctions. */
  private isDragTarget(state: InteractionState): boolean {
    return state.kind === "moving" && state.keys.some((k) => this.ownsKey(k));
  }

  override render() {
    if (this.path.length < 2) {
      return html``;
    }
    return html`<om-edge
      nodeId=${this.nodeId}
      .path=${this.path}
      .stroke=${this.stroke}
      ?clocked=${this.clocked}
      ?selected=${this.selectedKeys.has(`edge:${this.nodeId}`)}
      ?hovered=${this.hovered}
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
    this.applyJunctionHover();
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
      // Built transparent; `applyJunctionHover` reveals every disc while
      // the connection is hovered. Babylon's picker ignores
      // `mesh.visibility`, so the discs stay grabbable for the
      // connection-reshape gesture even at rest.
      disc.visibility = JUNCTION_IDLE_OPACITY;
      this.junctionMeshes.push(disc);
      waypointIdx++;
    }
    requestSceneRender(scene);
  }

  /**
   * Reveal every junction disc while the connection is hovered, hide
   * them all otherwise. Idempotent — skips the rAF when nothing changed.
   */
  private applyJunctionHover(): void {
    const opacity = this.hovered
      ? JUNCTION_HOVER_OPACITY
      : JUNCTION_IDLE_OPACITY;
    let changed = false;
    for (const disc of this.junctionMeshes) {
      if (disc.visibility !== opacity) {
        disc.visibility = opacity;
        changed = true;
      }
    }
    const scene = this.parentTransform?.getScene();
    if (changed && scene) {
      requestSceneRender(scene);
    }
  }

  /** Read-only access to the connection's hover state. Exposed for
   *  tests + future overlays that want a snapshot. */
  get isHovered(): boolean {
    return this.hovered;
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
