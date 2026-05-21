/**
 * Shared Modelica-type-shape helpers used by the class-level and
 * component-level parameter-form builders. Pure of vscode / dom imports.
 *
 * "Shape" here means: given a `ComponentElement.type` (which can be a
 * primitive name like `"Real"`, a nested `ModelInstance` aliased through
 * `extends`, or an enumeration type), resolve it to the small vocabulary
 * the parameter modal renders (scalar number/integer/boolean/string +
 * enum picker) and surface the metadata both builders need.
 */

import type {
  Annotation,
  ComponentElement,
  Expression,
  ExtendsElement,
  Modifier,
  ModelInstance,
} from "@modelica-wrapper/omc-client";

export type PrimitiveKind = "number" | "integer" | "boolean" | "string";

/**
 * Walk a (possibly aliased) Modelica type to one of the four primitive
 * roots — typical aliasing pattern is `type Angle = Real(unit="rad")`,
 * so we follow the first `extends` of each non-primitive type.
 *
 * Depth-limited (8) to guard against any pathological cycles in
 * malformed inputs.
 */
export function resolvePrimitive(
  type: ComponentElement["type"],
): PrimitiveKind | undefined {
  if (type === undefined) return undefined;
  if (typeof type === "string") return primitiveOf(type);
  let cursor: ModelInstance | string | undefined = type;
  for (let i = 0; i < 8; i += 1) {
    if (cursor === undefined) return undefined;
    if (typeof cursor === "string") return primitiveOf(cursor);
    const mi: ModelInstance = cursor;
    if (!Array.isArray(mi.elements)) return undefined;
    let ext: ExtendsElement | undefined;
    for (const e of mi.elements) {
      if (e.$kind === "extends") {
        ext = e;
        break;
      }
    }
    if (!ext) return primitiveOf(mi.name);
    cursor = ext.baseClass;
  }
  return undefined;
}

/**
 * Pull the declaration `unit` for a parameter component. The unit usually
 * rides on the type alias's `extends Real(unit="…")` (e.g.
 * `type Torque = Real(unit="N.m")`), so we read the component's own
 * modifiers first (a use-site `unit=` override is legal but rare), then
 * walk the type's `extends` chain looking for a `unit` modifier.
 *
 * Mirrors the producer's `parameterUnit` (`api/diagram/producer.ts`) so
 * the diagram-label path (#28/#71) and the parameter-editor path (#72)
 * surface the same declaration unit. Returns the unquoted unit string or
 * `undefined` when the parameter carries no unit. Depth-limited (8) to
 * guard against pathological cycles in malformed input.
 */
export function parameterUnit(el: ComponentElement): string | undefined {
  const direct = readModifierField(el.modifiers, "unit");
  if (direct) return unquoteString(direct);
  if (typeof el.type !== "object" || el.type === null) return undefined;
  let cursor: ModelInstance | string | undefined = el.type;
  for (let i = 0; i < 8; i += 1) {
    if (cursor === undefined || typeof cursor === "string") return undefined;
    const mi: ModelInstance = cursor;
    let ext: ExtendsElement | undefined;
    for (const child of mi.elements ?? []) {
      if (child.$kind === "extends") {
        const u = readModifierField(child.modifiers, "unit");
        if (u) return unquoteString(u);
        // Remember the first extends so we can keep walking aliases
        // (`Torque` extends `Real(unit=…)` directly, but deeper SI
        // hierarchies route through an intermediate type alias).
        if (ext === undefined) ext = child;
      }
    }
    if (ext === undefined) return undefined;
    cursor = ext.baseClass;
  }
  return undefined;
}

/**
 * Pull the `displayUnit` modifier off a parameter component (e.g.
 * `Angle phi(displayUnit="deg")`). OMC serializes it as a direct modifier
 * field on the component, distinct from the declaration `unit` which
 * usually rides on the type alias's `extends`. Returns the unquoted
 * string or `undefined` when not declared. Mirrors the producer's
 * `parameterDisplayUnit`.
 */
export function parameterDisplayUnit(el: ComponentElement): string | undefined {
  const direct = readModifierField(el.modifiers, "displayUnit");
  return direct ? unquoteString(direct) : undefined;
}

/**
 * Read a named field (`unit` / `displayUnit`) off a `Modifier` record,
 * flattening through a `$value` wrapper. Returns the raw (still-quoted)
 * string or `undefined`. Kept private; callers run `unquoteString`.
 */
function readModifierField(
  mod: Modifier | undefined,
  field: string,
): string | undefined {
  if (mod === undefined || mod === null || typeof mod !== "object") {
    return undefined;
  }
  const v = (mod as Record<string, Modifier>)[field];
  const s = flattenModifierString(v);
  return s.length > 0 ? s : undefined;
}

function flattenModifierString(mod: Modifier | undefined): string {
  if (mod === undefined || mod === null) return "";
  if (typeof mod === "string") return mod;
  if (typeof mod === "number" || typeof mod === "boolean") return String(mod);
  if (typeof mod === "object" && "$value" in mod) {
    return flattenModifierString((mod as { $value?: Modifier }).$value);
  }
  return "";
}

/**
 * Build the unit-related schema extension keys for a parameter component,
 * read off its declaration `unit` and `displayUnit`. Both builders spread
 * this onto the property schema so the field layer (`parameter-fields.ts`)
 * can surface them and the form can render a suffix / dropdown.
 *
 *   - `x-modelica-unit`         — the declaration unit (e.g. `"kg.m2"`)
 *   - `x-modelica-display-unit` — the component's `displayUnit` modifier
 *
 * Keys are omitted when absent so a unit-less parameter carries no unit
 * metadata at all (the form then renders nothing for it). The derived-unit
 * OPTION LIST + conversion factors are NOT computed here — they need an
 * OMC round-trip (`getDerivedUnits` / `convertUnits`) and are attached
 * host-side in `open-diagram.ts` where the `OmcClient` lives.
 */
export function unitSchemaExt(el: ComponentElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const unit = parameterUnit(el);
  if (unit !== undefined) out["x-modelica-unit"] = unit;
  const displayUnit = parameterDisplayUnit(el);
  if (displayUnit !== undefined) out["x-modelica-display-unit"] = displayUnit;
  return out;
}

export function primitiveOf(name: string | undefined): PrimitiveKind | undefined {
  switch (name) {
    case "Real":
      return "number";
    case "Integer":
      return "integer";
    case "Boolean":
      return "boolean";
    case "String":
      return "string";
    default:
      return undefined;
  }
}

/**
 * Detect an enumeration type and return its leaf names in declaration
 * order. Enum types extend the special `enumeration` baseClass and list
 * their literals as bare `component` elements with no variability prefix.
 */
export function enumLeavesIfEnum(
  type: ComponentElement["type"],
): string[] | undefined {
  if (!type || typeof type === "string") return undefined;
  const elements = type.elements ?? [];
  const extendsEnumeration = elements.some(
    (e) => e.$kind === "extends" && e.baseClass === "enumeration",
  );
  if (!extendsEnumeration) return undefined;
  const leaves: string[] = [];
  for (const e of elements) {
    if (e.$kind === "component") leaves.push(e.name);
  }
  return leaves.length > 0 ? leaves : undefined;
}

export function typeQualifiedName(
  type: ComponentElement["type"],
): string | undefined {
  if (!type || typeof type === "string") return undefined;
  return type.name;
}

export function stripPrefix(name: string, qualified: string): string {
  const prefix = `${qualified}.`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/**
 * OMC emits string-typed modifier bindings with embedded quotes
 * (`"\"rad\""`) — strip one layer so the user edits the inner text.
 */
export function unquoteString(s: string): string {
  if (s.length >= 2 && s.startsWith(`"`) && s.endsWith(`"`)) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Coerce a raw value (from `value.value`, `value.binding`, or a modifier
 * string) into the JSON-Schema kind the form expects. Returns `undefined`
 * for un-coercible inputs so the caller can fall back to a placeholder.
 */
export function coerceToKind(raw: unknown, kind: PrimitiveKind): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (kind === "boolean") {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") return raw === "true";
    return undefined;
  }
  if (kind === "number" || kind === "integer") {
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
      const n = kind === "integer" ? parseInt(raw, 10) : Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  }
  if (typeof raw === "string") return raw;
  return String(raw);
}

/**
 * Modelica Dialog-annotation defaults — see spec §18.7. We surface these
 * exact strings on the field even when the source code didn't bother to
 * spell them out, so the form's grouping logic always has something to
 * key on.
 */
export const DEFAULT_DIALOG_TAB = "General";
export const DEFAULT_DIALOG_GROUP = "Parameters";

export interface DialogInfo {
  tab: string;
  group: string;
  /**
   * Raw `Dialog.enable` AST when present. The form's evaluator
   * resolves crefs against the live working values, so the field's
   * `disabled` state updates as the user edits peers — that's what
   * OMC defers evaluation for. `undefined` means the field is
   * always enabled.
   */
  enable: Expression | undefined;
}

/**
 * Extract `tab` / `group` from a parameter's `annotation.Dialog`. Falls
 * back to the Modelica spec defaults when the annotation is missing or
 * malformed. We don't surface `enable` / `showStartAttribute` /
 * `groupImage` etc. yet — they're documented as future work in
 * `parameter-form.component.ts`.
 */
export function readDialogInfo(
  annotation: Annotation | undefined,
): DialogInfo {
  const fallback: DialogInfo = {
    tab: DEFAULT_DIALOG_TAB,
    group: DEFAULT_DIALOG_GROUP,
    enable: undefined,
  };
  if (!annotation) return fallback;
  const dlg = (annotation as { Dialog?: unknown }).Dialog;
  if (!dlg || typeof dlg !== "object" || Array.isArray(dlg)) return fallback;
  const obj = dlg as { tab?: unknown; group?: unknown; enable?: unknown };
  return {
    tab: typeof obj.tab === "string" ? obj.tab : DEFAULT_DIALOG_TAB,
    group: typeof obj.group === "string" ? obj.group : DEFAULT_DIALOG_GROUP,
    // `enable` is plain JSON (a literal boolean, or an Expression AST).
    // Pass it through untouched; the evaluator handles every shape.
    enable: obj.enable as Expression | undefined,
  };
}

/**
 * Best-effort one-line stringification for a parameter's current binding
 * — used by the read-only display of "unsupported" (non-scalar / record /
 * complex-expression) parameters so the user at least sees what's there.
 *
 * Preference order matches the editable path:
 *   1. `value.value`   — OMC's evaluated literal
 *   2. `value.binding` — raw binding (may be a tagged expression)
 *   3. `modifiers`     — user-written modifier text
 * Returns `""` when none of those carry anything renderable.
 */
export function renderCurrentBinding(el: ComponentElement): string {
  const v = el.value;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const evaluated = (v as { value?: unknown }).value;
    if (evaluated !== undefined && evaluated !== null) {
      return stringifyForDisplay(evaluated);
    }
    const binding = (v as { binding?: unknown }).binding;
    if (binding !== undefined && binding !== null) {
      return stringifyForDisplay(binding);
    }
  }
  if (el.modifiers !== undefined) {
    return stringifyForDisplay(el.modifiers as Modifier);
  }
  return "";
}

function stringifyForDisplay(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return String(v);
  }
  // Tagged-expression objects (`{$kind: "enum", name: "..."}`,
  // `{$kind: "binary_op", ...}`) → take the most-useful field. Falls
  // back to a JSON dump so the user sees *something* rather than
  // `[object Object]`.
  if (typeof v === "object") {
    const obj = v as { $kind?: unknown; name?: unknown; op?: unknown };
    if (obj.$kind === "enum" && typeof obj.name === "string") {
      return obj.name;
    }
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/**
 * Translate a single submitted form value into the Modelica expression
 * `setElementModifierValue` expects. Mirrors `coerceToKind` in reverse:
 *  - numbers / booleans → their literal form (`12`, `true`)
 *  - strings (for string-typed params) → wrapped in `"..."`
 *  - enums → `<qualified>.<leaf>`
 *  - `unsupported` → always `""` (the form never edits these, so the
 *    submit translator must never produce a non-empty expression for
 *    them; the caller separately filters them out before writing)
 *  - `undefined` / `""` → empty string (caller treats as "clear")
 */
export function valueToExpr(
  kind: PrimitiveKind | "enum" | "unsupported",
  value: unknown,
  enumTypeName?: string,
): string {
  if (kind === "unsupported") return "";
  if (value === undefined || value === null || value === "") return "";
  switch (kind) {
    case "boolean":
      return value === true || value === "true" ? "true" : "false";
    case "number":
    case "integer":
      return String(value);
    case "string":
      return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    case "enum":
      if (!enumTypeName) return String(value);
      return `${enumTypeName}.${String(value)}`;
  }
}
