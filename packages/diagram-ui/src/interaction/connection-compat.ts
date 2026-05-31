/**
 * Local compatibility check for connection creation. OMC is the
 * authoritative validator (call `addConnection` and inspect the
 * error), but doing the check client-side lets the UI:
 *
 *   - refuse the drop on an incompatible target so the connection
 *     drag silently fails instead of round-tripping to OMC,
 *   - colour the rubber-band edge / target highlight to tell the
 *     user *while they drag* whether the drop will work,
 *   - surface a concrete reason ("input → input" / "type mismatch")
 *     without parsing OMC's error string.
 *
 * The check is deliberately conservative — when in doubt, return
 * `{ ok: true }` and let OMC have the final say. False-positives are
 * fine (OMC rejects the drop), false-negatives are not (we'd block a
 * connection OMC would accept). Inheritance, partial classes, and
 * stream connectors are outside the scope of this local check.
 */

import type { DiagramLayout, PortDef } from "@dicode/omc-client";

import { isConnectorKey, parseKey } from "./node-keys.js";

export interface PortInfo {
  /** Qualified type name of the connector class. */
  typeName: string;
  /** Effective causality: explicit prefix wins; otherwise inferred
   *  from the type-name suffix (`*Input` / `*Output`) which is the
   *  Modelica convention for the Blocks / Real-Input/Output family. */
  direction: "input" | "output" | "" | "unknown";
  flow: boolean;
  stream: boolean;
}

export interface CompatibilityResult {
  ok: boolean;
  /** Short reason for the rejection. `undefined` when `ok` is true. */
  reason?: string;
}

const INPUT_SUFFIX = /Input$/;
const OUTPUT_SUFFIX = /Output$/;

/**
 * Resolve a UI connector key (`k:p` standalone, `k:R1.p` nested) into
 * the `PortInfo` needed for compatibility checking. Returns `null` if
 * the key doesn't correspond to anything in `layout` — which is
 * expected for in-flight drag targets that haven't been picked yet.
 */
export function resolvePortInfo(
  layout: DiagramLayout,
  key: string,
): PortInfo | null {
  const parsed = parseKey(key);
  if (!parsed || !isConnectorKey(parsed)) {
    return null;
  }
  if (parsed.componentName === null) {
    // Standalone host connector. Its type IS the connector class —
    // we don't have a per-instance PortDef so we can only read the
    // class name + suffix-infer direction. Flow/stream are unknown
    // without fetching the connector class definition.
    const conn = layout.connectors[parsed.portName];
    if (!conn) return null;
    return {
      typeName: conn.classRef,
      direction: inferDirectionFromTypeName(conn.classRef),
      flow: false,
      stream: false,
    };
  }
  // Nested: walk component → class → connectors map.
  const comp = layout.components[parsed.componentName];
  if (!comp) return null;
  const cls = layout.classes[comp.classRef];
  if (!cls) return null;
  const port = cls.connectors[parsed.portName];
  if (!port) return null;
  return portInfoFromPortDef(port);
}

function portInfoFromPortDef(port: PortDef): PortInfo {
  const explicit = port.direction;
  const direction: PortInfo["direction"] =
    explicit === "input" || explicit === "output"
      ? explicit
      : inferDirectionFromTypeName(port.typeName);
  return {
    typeName: port.typeName,
    direction,
    flow: port.flow === true,
    stream: port.stream === true,
  };
}

/** "*.RealInput" → "input", "*.RealOutput" → "output", else "unknown". */
function inferDirectionFromTypeName(
  typeName: string,
): "input" | "output" | "unknown" {
  const tail = typeName.includes(".")
    ? typeName.slice(typeName.lastIndexOf(".") + 1)
    : typeName;
  if (INPUT_SUFFIX.test(tail)) return "input";
  if (OUTPUT_SUFFIX.test(tail)) return "output";
  return "unknown";
}

/**
 * Decide whether `from` and `to` can be wired together. Rules
 * (intentionally lenient — OMC re-validates on `addConnection`):
 *
 *   1. Self-connection is rejected (handled by the caller via
 *      `excludeKey`; not encoded here).
 *   2. If both directions are known, they must be opposite
 *      (`input ↔ output`).
 *   3. If both types are identical, accept regardless of direction —
 *      catches the common "both `Pin`" and "both `Flange_a`" cases.
 *   4. If types differ AND directions don't conflict, accept and let
 *      OMC decide. Inheritance trees (e.g. `RealInput extends Real`)
 *      aren't walked here.
 *   5. Flow/stream mismatches aren't blocked either — OMC handles
 *      it. We could tighten this if it produces too many failed-drop
 *      surprises in practice.
 */
export function canConnect(from: PortInfo, to: PortInfo): CompatibilityResult {
  // Causality first: two known directional connectors with the SAME
  // direction can never pair. This rules out `RealInput ↔ RealInput`
  // (same type, same direction) before the type-equality test can
  // wave it through.
  const dirsKnown = from.direction !== "unknown" && to.direction !== "unknown";
  const bothInput = from.direction === "input" && to.direction === "input";
  const bothOutput = from.direction === "output" && to.direction === "output";
  if (dirsKnown && (bothInput || bothOutput)) {
    return { ok: false, reason: `both ${from.direction}` };
  }
  // Same type, no direction conflict: accept. Covers acausal pairs
  // (`Pin ↔ Pin`, `Flange_a ↔ Flange_a`) and directional pairs that
  // somehow ended up paired (caught above already).
  if (from.typeName === to.typeName) {
    return { ok: true };
  }
  // Different types: heuristic — Modelica's standard library puts
  // compatible connector pairs in the same package
  // (`Modelica.Blocks.Interfaces.RealInput/RealOutput`,
  // `Modelica.Mechanics.Rotational.Interfaces.Flange_a/Flange_b`,
  // `Modelica.Electrical.Analog.Interfaces.PositivePin/NegativePin`),
  // and incompatible domains live in different packages
  // (`Real*` ↔ `Flange*` cross domains and would be wrong). We
  // accept when packages match and let OMC catch the rare
  // same-package-but-still-incompatible cases; we reject when
  // packages differ so the user gets immediate feedback.
  //
  // Limitation: connector types defined via `connector X = Y` alias
  // can land in a different package than their alias target and
  // still be compatible. That edge case will produce a false
  // rejection here; the user can ignore the red highlight and OMC
  // will accept the drop if they force it (but we currently refuse
  // the drop, so they'd have to edit the source). Tighten if it
  // bites in practice.
  if (samePackage(from.typeName, to.typeName)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `incompatible types (${shortName(from.typeName)} ↔ ${shortName(to.typeName)})`,
  };
}

/** Last dot-segment of a qualified name. */
function shortName(typeName: string): string {
  const dot = typeName.lastIndexOf(".");
  return dot < 0 ? typeName : typeName.slice(dot + 1);
}

/** Returns the package path (everything before the last dot). */
function packageOf(typeName: string): string {
  const dot = typeName.lastIndexOf(".");
  return dot < 0 ? "" : typeName.slice(0, dot);
}

function samePackage(a: string, b: string): boolean {
  const pa = packageOf(a);
  const pb = packageOf(b);
  return pa !== "" && pa === pb;
}
