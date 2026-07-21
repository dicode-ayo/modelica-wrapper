/**
 * Helpers for extracting `Placement` from a component's annotation and for
 * flattening `cref` paths into connection endpoints.
 *
 * OMC's annotation routes the geometry through `annotation.Placement`, with
 * `transformation` (diagram-mode placement) and `iconTransformation`
 * (icon-mode placement on the ports of a class) as parallel structures
 * carrying the same `extent` / `origin` / `rotation` triple. The producer
 * picks one based on `kind`; this module just decodes whichever it's given.
 */

import type {
  ComponentElement,
  ComponentRef,
  ComponentRefPart,
  PlacementAnnotation,
} from "../../_shared/modelInstance.js";
import { expressionToString } from "../../eval/expression-to-string.js";
import type {
  ConnectionEndpoint,
  Extent,
  Placement,
  Point,
} from "../../_shared/diagramLayout.js";

/**
 * Decode a 2-element `[x, y]` array of finite numbers, or `undefined` if the
 * input is missing/malformed. Conservative: any non-number entry yields
 * `undefined` rather than `NaN` propagating into the layout.
 */
function decodePoint(value: unknown): Point | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [x, y] = value;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return [x, y];
}

/**
 * Decode `[[x1,y1],[x2,y2]]`. Returns `undefined` if either corner is
 * missing or malformed — callers handle the "no extent" case explicitly.
 */
function decodeExtent(value: unknown): Extent | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const a = decodePoint(value[0]);
  const b = decodePoint(value[1]);
  if (!a || !b) return undefined;
  return [a, b];
}

/**
 * Build a `Placement` from a `PlacementAnnotation`'s transformation block
 * (either `transformation` for diagram-mode or `iconTransformation` for
 * icon-mode). Returns `undefined` if no usable extent is present —
 * Modelica requires extent for a placement to render.
 */
function placementFromTransformation(
  t: NonNullable<PlacementAnnotation["transformation"]>,
): Placement | undefined {
  const extent = decodeExtent(t.extent);
  if (!extent) return undefined;
  const placement: Placement = { extent };
  const origin = decodePoint(t.origin);
  if (origin) placement.origin = origin;
  if (typeof t.rotation === "number" && Number.isFinite(t.rotation)) {
    placement.rotation = t.rotation;
  }
  return placement;
}

/**
 * Pick a `Placement` for a component element given the layout kind.
 *
 * - `kind === "diagram"`: prefers `transformation`, falls back to
 *   `iconTransformation` (some library components only define one).
 * - `kind === "icon"`: prefers `iconTransformation`, falls back to
 *   `transformation`. This is what's used for ports on a class's icon —
 *   the connector's icon-mode position relative to the host class.
 *
 * Returns `undefined` when neither path yields a usable extent. The
 * producer treats that as "skip this element from layout output".
 */
export function placementFor(
  element: ComponentElement,
  kind: "icon" | "diagram",
): Placement | undefined {
  const placementAnno = element.annotation?.Placement;
  if (!placementAnno) return undefined;
  const primary =
    kind === "icon"
      ? placementAnno.iconTransformation
      : placementAnno.transformation;
  const secondary =
    kind === "icon"
      ? placementAnno.transformation
      : placementAnno.iconTransformation;
  if (primary) {
    const out = placementFromTransformation(primary);
    if (out) return out;
  }
  if (secondary) {
    const out = placementFromTransformation(secondary);
    if (out) return out;
  }
  return undefined;
}

/**
 * Flatten a `ComponentRef` (the `lhs`/`rhs` of a `connect(...)` call) into
 * `{ component, port }`.
 *
 *  - 1 part:  `[{name:"u"}]`            → `{ component: undefined, port: "u" }`
 *             (a port on the host class itself)
 *  - 2 parts: `[{name:"spring"},{name:"flange_b"}]`
 *                                      → `{ component: "spring", port: "flange_b" }`
 *  - 3+ parts (e.g. `a.inner.x`):
 *             collapsed to first-part component and last-part port.
 *             TODO: full path support if/when nested-component port
 *             access matters to the renderer (rare in practice).
 *  - 0 parts: a malformed cref. We bubble that up by returning `undefined`
 *             so the producer can skip the connection rather than emit a
 *             silently-broken endpoint.
 */
export function flattenCref(ref: ComponentRef): ConnectionEndpoint | undefined {
  const parts = ref.parts;
  if (!parts || parts.length === 0) return undefined;
  if (parts.length === 1) {
    const portPart = parts[0];
    if (portPart === undefined || typeof portPart.name !== "string") {
      return undefined;
    }
    return {
      component: undefined,
      port: portPart.name,
      ...withKey("portSubscripts", renderSubscripts(portPart)),
    };
  }
  const firstPart = parts[0];
  const lastPart = parts[parts.length - 1];
  if (
    firstPart === undefined ||
    lastPart === undefined ||
    typeof firstPart.name !== "string" ||
    typeof lastPart.name !== "string"
  ) {
    return undefined;
  }
  return {
    component: firstPart.name,
    port: lastPart.name,
    ...withKey("componentSubscripts", renderSubscripts(firstPart)),
    ...withKey("portSubscripts", renderSubscripts(lastPart)),
  };
}

/** `"[3]"`, `"[1, 2]"`, … for a subscripted part; `undefined` otherwise. */
function renderSubscripts(part: ComponentRefPart): string | undefined {
  const subs = part.subscripts;
  if (!subs || subs.length === 0) return undefined;
  return `[${subs.map((s) => expressionToString(s)).join(", ")}]`;
}

/** Spreadable single-key object, or `{}` when the value is absent — keeps
 *  `exactOptionalPropertyTypes` happy without writing `key: undefined`. */
function withKey<K extends string>(
  key: K,
  value: string | undefined,
): Record<K, string> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

export const _internal = {
  decodePoint,
  decodeExtent,
  placementFromTransformation,
};
