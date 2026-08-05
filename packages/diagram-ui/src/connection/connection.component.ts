import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ContextConsumer, consume } from "@lit/context";
import { Circle, Container, Graphics } from "pixi.js";
import type { Point } from "@dicode/omc-client";

import { parentNodeContext } from "../base/parent-node-context.js";
import { setHighlight } from "../base/selection-overlay.js";
import { sceneContext, type SceneContext } from "../scene/scene-context.js";
import { pointsEqual } from "../interaction/connection-route.js";
import {
  interactionStateContext,
  type InteractionState,
  type InteractionStateStore,
} from "../interaction/interaction-state.js";
import { parseKey } from "../interaction/entity-keys.js";
import { readEntityMeta, tagEntity } from "../interaction/node-keys.js";
import { WAYPOINT_RADIUS } from "./edge-build.js";
import { parseCssColor } from "./parse-color.js";
import "./edge.component.js";

/** Near-black slate, matching the default edge colour. */
const JUNCTION_BASE_COLOR = 0x1a1a2e;
const SELECTED_COLOR = 0x3d82f5; // blue-500, matches edges
/**
 * Resting alpha of junction discs — fully transparent so the route reads
 * as a clean polyline at rest. The explicit `hitArea` keeps each disc
 * grabbable even at `alpha = 0`, so the user can still pick a waypoint at
 * a route corner.
 */
const JUNCTION_IDLE_OPACITY = 0;
/** Alpha of every junction disc while the connection is hovered. */
const JUNCTION_HOVER_OPACITY = 1;
/** Paint band placing the discs above the edge line, below connectors. */
const JUNCTION_Z_INDEX = 0.01;

/**
 * `<om-connection>` — composes one `<om-edge>` with optional junction
 * markers at internal waypoints. Our `DiagramLayout` schema doesn't
 * model junctions explicitly (a connection has a single waypoint
 * list); we draw a small marker at each internal corner so a many-
 * segment connection reads as one routed line, not a polygon.
 *
 * Properties:
 *   - `path`             — `Point[]` of waypoints
 *   - `stroke`           — CSS colour (`#rrggbb` or `rgb(r,g,b)`), forwarded
 *                          to <om-edge>
 *   - `clocked`          — dashed pattern, forwarded
 *   - `showJunctions`    — render a dot at each internal waypoint
 *   - `selectedKeys`     — set of entity keys (`edge:<nodeId>` and
 *                          `junc:<nodeId>/<waypointIdx>`) that are
 *                          currently selected; drives the highlight
 *                          colour on the edge + outline on each junction.
 *
 * Endpoint dots (first / last) are deliberately NOT drawn — the
 * connectors at each end already provide the visual terminator.
 *
 * Junction identity uses a compound nodeId of
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
  private parentTransform: Container | null = null;

  @consume({ context: sceneContext, subscribe: true })
  private sceneCtx: SceneContext | null = null;

  /**
   * Hover tracking is self-managed: the host (`<om-graphical-layout>`)
   * publishes the current pointer-hover key into
   * `interactionStateContext`, and we subscribe directly. Doing the
   * matching here (instead of having the host walk every
   * `<om-connection>` and call setters) keeps the junction-id format
   * encapsulated inside the component that owns the discs.
   */
  private interactionUnsubscribe: (() => void) | null = null;

  private junctionDiscs: Graphics[] = [];
  private highlightedJunctions = new Set<Graphics>();
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
   * waypoints (empty `junctionDiscs`).
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
   * (`junc:${this.nodeId}/${idx}`).
   */
  private ownsKey(key: string | null): boolean {
    if (!key) return false;
    const parsed = parseKey(key);
    if (!parsed) return false;
    if (parsed.kind === "edge") return parsed.nodeId === this.nodeId;
    if (parsed.kind === "junction") {
      return String(parsed.connIndex) === this.nodeId;
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
      // Try an in-place position update first. Disposing + recreating the
      // discs on every pointermove of a component drag (which shifts the
      // connection waypoints) is the visible "junction dot flicker".
      // Falls back to a full rebuild if the internal-waypoint count
      // changed (the topology actually differs, not just the coords).
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
   * discs haven't been built yet) — the caller falls back to a full
   * rebuild in that case.
   */
  private updateJunctionPositions(): boolean {
    const internal = this.path.slice(1, -1);
    if (internal.length !== this.junctionDiscs.length) {
      return false;
    }
    for (let i = 0; i < internal.length; i++) {
      const point = internal[i];
      const disc = this.junctionDiscs[i];
      if (point === undefined || disc === undefined) {
        return false;
      }
      disc.position.set(point[0], point[1]);
    }
    this.builtPath = this.path;
    this.sceneCtx?.requestRender();
    return true;
  }

  private rebuildJunctions(): void {
    this.disposeJunctions();
    const parent = this.parentTransform;
    // Leave `builtPath` null until the parent context arrives, so a build
    // attempted before mount is retried once the parent is available rather
    // than being marked done and skipped.
    if (!parent) {
      return;
    }
    this.builtPath = this.path;
    if (!this.showJunctions) {
      return;
    }
    const internal = this.path.slice(1, -1);
    if (internal.length === 0) {
      this.sceneCtx?.requestRender();
      return;
    }
    const color = parseCssColor(this.stroke) ?? JUNCTION_BASE_COLOR;
    parent.sortableChildren = true;

    // Internal waypoints map to `path` indices 1 .. path.length - 2.
    let waypointIdx = 1;
    for (const [x, y] of internal) {
      const compoundId = `${this.nodeId}/${waypointIdx}`;
      const disc = new Graphics();
      disc.circle(0, 0, this.junctionRadius).fill(color);
      disc.position.set(x, y);
      disc.zIndex = JUNCTION_Z_INDEX;
      disc.eventMode = "static";
      disc.hitArea = new Circle(0, 0, this.junctionRadius);
      // Built transparent; `applyJunctionHover` reveals every disc while
      // the connection is hovered. The explicit `hitArea` keeps it
      // grabbable for the reshape gesture even at rest.
      disc.alpha = JUNCTION_IDLE_OPACITY;
      tagEntity(disc, "junction", compoundId);
      parent.addChild(disc);
      this.junctionDiscs.push(disc);
      waypointIdx++;
    }
    this.sceneCtx?.requestRender();
  }

  /**
   * Reveal every junction disc while the connection is hovered, hide
   * them all otherwise. Idempotent — skips the render when nothing changed.
   */
  private applyJunctionHover(): void {
    const alpha = this.hovered ? JUNCTION_HOVER_OPACITY : JUNCTION_IDLE_OPACITY;
    let changed = false;
    for (const disc of this.junctionDiscs) {
      if (disc.alpha !== alpha) {
        disc.alpha = alpha;
        changed = true;
      }
    }
    if (changed) {
      this.sceneCtx?.requestRender();
    }
  }

  /** Read-only access to the connection's hover state. Exposed for
   *  tests + future overlays that want a snapshot. */
  get isHovered(): boolean {
    return this.hovered;
  }

  private applyJunctionSelection(): void {
    const ctx = this.sceneCtx;
    if (!ctx) {
      return;
    }
    // Remove highlights that no longer apply.
    for (const disc of [...this.highlightedJunctions]) {
      const id = readEntityMeta(disc)?.nodeId;
      if (id && !this.selectedKeys.has(`junc:${id}`)) {
        setHighlight(ctx, disc, null);
        this.highlightedJunctions.delete(disc);
      }
    }
    // Add highlights for newly-selected junctions.
    for (const disc of this.junctionDiscs) {
      const id = readEntityMeta(disc)?.nodeId;
      if (id && this.selectedKeys.has(`junc:${id}`)) {
        if (!this.highlightedJunctions.has(disc)) {
          setHighlight(ctx, disc, SELECTED_COLOR);
          this.highlightedJunctions.add(disc);
        }
      }
    }
  }

  private disposeJunctions(): void {
    const ctx = this.sceneCtx;
    for (const disc of this.junctionDiscs) {
      if (ctx && this.highlightedJunctions.has(disc)) {
        setHighlight(ctx, disc, null);
      }
      disc.destroy();
    }
    this.junctionDiscs = [];
    this.highlightedJunctions.clear();
    // Clear the "built against" sentinel so a reconnect (or any next
    // `rebuildJunctions`) starts from a clean slate. `rebuildJunctions`
    // re-sets it immediately after calling us; the order is fine.
    this.builtPath = null;
  }

  get junctions(): Graphics[] {
    return this.junctionDiscs;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-connection": OmConnection;
  }
}
