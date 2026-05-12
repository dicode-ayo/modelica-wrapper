/**
 * Expression resolver + scene producer + ModelInstance join for the
 * MultiBody visual data path. All pure functions; no OMC contact and no
 * file I/O. Inputs:
 *
 *  - `VisualXmlDocument` from `parseVisualXml(xml)`
 *  - `env: Map<string, number>` from `readResultRowZero(_res.mat)`
 *    (later PR; the resolver doesn't care where the values came from)
 *  - `ModelInstance` from `getModelInstance`
 *
 * Outputs:
 *
 *  - `VisualScene` — every numeric slot is a `number`; shapes whose
 *    expression tree still references an unknown cref carry
 *    `unresolved: true` so the renderer can show a placeholder
 *  - `MultibodyScene` — same shape with `componentRef` populated by
 *    first-dotted-path-segment lookup against the `ModelInstance` tree
 */

import type {
  ComponentElement,
  ComponentRef,
  ModelInstance,
} from "./modelInstance.js";
import type {
  MultibodyScene,
  Vec3,
  VisualScene,
  VisualShape,
  VisualSurface,
  VisualVector,
  VisualXmlDocument,
  XmlExpr,
  XmlMat3,
  XmlShape,
  XmlSurface,
  XmlVec3,
  XmlVector,
} from "./visualScene.js";

// =====================================================================
// resolveExpressions — XmlExpr → number | "unresolved"
// =====================================================================

/**
 * Tri-state evaluation result. `null` is "this slot depends on a cref
 * that's not in `env`" — the resolver propagates it through arithmetic
 * (a missing operand turns the result null) so any shape with even one
 * unresolved leaf ends up flagged. We use a sentinel object rather than
 * `undefined` so `0` doesn't get confused with "no value".
 */
type Eval = { ok: true; value: number } | { ok: false };

const UNRESOLVED: Eval = { ok: false };

function evalExpr(expr: XmlExpr, env: Map<string, number>): Eval {
  switch (expr.kind) {
    case "lit":
      return { ok: true, value: expr.value };
    case "cref": {
      const v = env.get(expr.name);
      return v === undefined ? UNRESOLVED : { ok: true, value: v };
    }
    case "unary": {
      const inner = evalExpr(expr.exp, env);
      if (!inner.ok) return UNRESOLVED;
      return { ok: true, value: -inner.value };
    }
    case "binary": {
      const l = evalExpr(expr.lhs, env);
      if (!l.ok) return UNRESOLVED;
      const r = evalExpr(expr.rhs, env);
      if (!r.ok) return UNRESOLVED;
      switch (expr.op) {
        case "+":
          return { ok: true, value: l.value + r.value };
        case "-":
          return { ok: true, value: l.value - r.value };
        case "*":
          return { ok: true, value: l.value * r.value };
        case "/":
          return { ok: true, value: l.value / r.value };
      }
      return UNRESOLVED;
    }
    case "call": {
      const args: number[] = [];
      for (const a of expr.args) {
        const r = evalExpr(a, env);
        if (!r.ok) return UNRESOLVED;
        args.push(r.value);
      }
      switch (expr.fn) {
        case "cos":
          if (args.length !== 1) return UNRESOLVED;
          return { ok: true, value: Math.cos(args[0]!) };
        case "sin":
          if (args.length !== 1) return UNRESOLVED;
          return { ok: true, value: Math.sin(args[0]!) };
        case "sqrt":
          if (args.length !== 1) return UNRESOLVED;
          return { ok: true, value: Math.sqrt(args[0]!) };
      }
      return UNRESOLVED;
    }
  }
}

/**
 * Track shape-level "any slot unresolved" via a mutable flag rather than
 * threading return values: the slot decoders are dense (a 3x3 matrix is
 * 9 calls per shape), and `flag.touched = true` is cheaper than wiring
 * `{value, unresolved}` returns through every helper. Caller seeds a
 * fresh flag per shape.
 */
type UnresolvedFlag = { touched: boolean };

function evalScalar(
  expr: XmlExpr,
  env: Map<string, number>,
  flag: UnresolvedFlag,
): number {
  const r = evalExpr(expr, env);
  if (!r.ok) {
    flag.touched = true;
    return Number.NaN;
  }
  return r.value;
}

function evalVec3(
  v: XmlVec3,
  env: Map<string, number>,
  flag: UnresolvedFlag,
): Vec3 {
  return [
    evalScalar(v[0], env, flag),
    evalScalar(v[1], env, flag),
    evalScalar(v[2], env, flag),
  ];
}

function evalMat3(
  m: XmlMat3,
  env: Map<string, number>,
  flag: UnresolvedFlag,
): [Vec3, Vec3, Vec3] {
  return [evalVec3(m[0], env, flag), evalVec3(m[1], env, flag), evalVec3(m[2], env, flag)];
}

function resolveShape(
  xs: XmlShape,
  env: Map<string, number>,
): VisualShape {
  const flag: UnresolvedFlag = { touched: false };
  const shape: VisualShape = {
    kind: "shape",
    ident: xs.ident,
    shapeType: xs.shapeType,
    r: evalVec3(xs.r, env, flag),
    T: evalMat3(xs.T, env, flag),
    rShape: evalVec3(xs.rShape, env, flag),
    lengthDirection: evalVec3(xs.lengthDirection, env, flag),
    widthDirection: evalVec3(xs.widthDirection, env, flag),
    length: evalScalar(xs.length, env, flag),
    width: evalScalar(xs.width, env, flag),
    height: evalScalar(xs.height, env, flag),
    extra: evalScalar(xs.extra, env, flag),
    color: [
      evalScalar(xs.color[0], env, flag),
      evalScalar(xs.color[1], env, flag),
      evalScalar(xs.color[2], env, flag),
    ],
    specularCoefficient: evalScalar(xs.specularCoefficient, env, flag),
  };
  if (flag.touched) shape.unresolved = true;
  return shape;
}

function resolveVector(
  xv: XmlVector,
  env: Map<string, number>,
): VisualVector {
  const flag: UnresolvedFlag = { touched: false };
  // Booleans come through as numeric `<exp>` slots (0/1 in OMC's template).
  const headAtOriginN = evalScalar(xv.headAtOrigin, env, flag);
  const twoHeadedN = evalScalar(xv.twoHeadedArrow, env, flag);
  const v: VisualVector = {
    kind: "vector",
    ident: xv.ident,
    r: evalVec3(xv.r, env, flag),
    T: evalMat3(xv.T, env, flag),
    coordinates: evalVec3(xv.coordinates, env, flag),
    color: [
      evalScalar(xv.color[0], env, flag),
      evalScalar(xv.color[1], env, flag),
      evalScalar(xv.color[2], env, flag),
    ],
    specularCoefficient: evalScalar(xv.specularCoefficient, env, flag),
    quantity: xv.quantity,
    headAtOrigin: headAtOriginN !== 0,
    twoHeadedArrow: twoHeadedN !== 0,
  };
  if (flag.touched) v.unresolved = true;
  return v;
}

function resolveSurface(
  xs: XmlSurface,
  env: Map<string, number>,
): VisualSurface {
  const flag: UnresolvedFlag = { touched: false };
  const wireframeN = evalScalar(xs.wireframe, env, flag);
  const multiColoredN = evalScalar(xs.multiColored, env, flag);
  const s: VisualSurface = {
    kind: "surface",
    ident: xs.ident,
    r: evalVec3(xs.r, env, flag),
    T: evalMat3(xs.T, env, flag),
    nu: evalScalar(xs.nu, env, flag),
    nv: evalScalar(xs.nv, env, flag),
    color: [
      evalScalar(xs.color[0], env, flag),
      evalScalar(xs.color[1], env, flag),
      evalScalar(xs.color[2], env, flag),
    ],
    specularCoefficient: evalScalar(xs.specularCoefficient, env, flag),
    transparency: evalScalar(xs.transparency, env, flag),
    wireframe: wireframeN !== 0,
    multiColored: multiColoredN !== 0,
  };
  if (flag.touched) s.unresolved = true;
  return s;
}

/**
 * Resolve every slot in a `VisualXmlDocument` against `env`. Shapes /
 * vectors / surfaces whose expression tree still references an unknown
 * cref are emitted with `unresolved: true` and `NaN` in the unresolved
 * slots — the renderer is expected to short-circuit unresolved entries
 * to a placeholder bounding box, not to read individual slot values.
 */
export function resolveExpressions(
  doc: VisualXmlDocument,
  env: Map<string, number>,
): VisualScene {
  return {
    shapes: doc.shapes.map((s) => resolveShape(s, env)),
    vectors: doc.vectors.map((v) => resolveVector(v, env)),
    surfaces: doc.surfaces.map((s) => resolveSurface(s, env)),
  };
}

/**
 * Convenience: alias for `resolveExpressions` against an already-parsed
 * document. Kept as a separate name because the design doc names
 * `produceVisualScene` as the public surface for the combined parse+
 * resolve operation, even though PR 1's parser lives in a sibling module.
 */
export function produceVisualScene(
  doc: VisualXmlDocument,
  env: Map<string, number>,
): VisualScene {
  return resolveExpressions(doc, env);
}

// =====================================================================
// joinWithModelInstance — shape <ident> ↔ ComponentElement
// =====================================================================

/**
 * Index every top-level `ComponentElement` on `mi` by name. The join rule
 * is "first dotted-path segment of `<ident>` is a component name on the
 * host model". Nested compositions resolve via the top-level wrapper —
 * e.g. a `BodyShape` inside a sub-model is still selectable through the
 * top-level instance it lives under.
 */
function indexComponents(mi: ModelInstance): Map<string, ComponentElement> {
  const out = new Map<string, ComponentElement>();
  for (const el of mi.elements ?? []) {
    if (el.$kind !== "component") continue;
    out.set(el.name, el);
  }
  return out;
}

function componentRefFor(name: string): ComponentRef {
  return { $kind: "cref", parts: [{ name }] };
}

function firstSegment(ident: string): string {
  const dot = ident.indexOf(".");
  return dot === -1 ? ident : ident.slice(0, dot);
}

/**
 * Attach `componentRef` to every visualizer in `scene`. The lookup is
 * pure structural: split `ident` on `.`, take segment 0, look it up in
 * the top-level component index. A hit gives a one-part `ComponentRef`;
 * a miss leaves `componentRef = null` so the renderer can recognize
 * synthetic shapes (gravity arrow, world frame triad) and skip
 * selection wiring for them.
 *
 * Already-set `componentRef` values are preserved verbatim — callers can
 * pre-populate (e.g. for fixture-built scenes in tests) without losing
 * the override.
 */
export function joinWithModelInstance(
  scene: VisualScene,
  mi: ModelInstance,
): MultibodyScene {
  const index = indexComponents(mi);
  const attach = <T extends { ident: string; componentRef?: ComponentRef | null | undefined }>(
    entry: T,
  ): T => {
    if (entry.componentRef !== undefined) return entry;
    const segment = firstSegment(entry.ident);
    const hit = index.get(segment);
    const next: T = { ...entry };
    next.componentRef = hit ? componentRefFor(segment) : null;
    return next;
  };

  return {
    shapes: scene.shapes.map(attach),
    vectors: scene.vectors.map(attach),
    surfaces: scene.surfaces.map(attach),
  };
}
