/**
 * Helpers that turn the active class's `ModelInstance` into the
 * `{schema, values}` pair the parameter modal renders.
 *
 * Parameters declared on ancestors via `extends` are surfaced too: the
 * walk visits ancestors first and the host last, so a parameter
 * redeclared on the host overwrites the inherited entry (Modelica
 * flattening semantics).
 *
 * The form vocabulary is the small one `<om-parameter-form>` already
 * understands (scalar number / integer / boolean / string + enum
 * picker); types outside that vocabulary are skipped so the form
 * doesn't show widgets it can't drive.
 *
 * Pure of vscode / dom imports — tested with plain modelInstance JSON.
 */

import type {
  ComponentElement,
  JsonSchema,
  ModelInstance,
} from "@modelica-wrapper/omc-client";

import {
  coerceToKind,
  enumLeavesIfEnum,
  readDialogInfo,
  renderCurrentBinding,
  resolvePrimitive,
  stripPrefix,
  typeQualifiedName,
  unitSchemaExt,
  unquoteString,
  valueToExpr,
  type DialogInfo,
  type PrimitiveKind,
} from "./parameter-shape.js";

/**
 * Per-field metadata the submit handler needs to translate a form value
 * back into a Modelica expression and target the right `elementName`
 * on `setElementModifierValue`. Kept alongside the schema so the
 * round-trip stays self-contained — the panel layer only sees a
 * `JsonSchema` + values record, and the submit side reads this map to
 * decide what string to send to OMC.
 */
export interface ClassParameterRef {
  /** Property name (== schema key, == component name on the host class). */
  name: string;
  /**
   * Modelica type kind. `"unsupported"` covers record / array / complex
   * parameter types we can't yet edit — the form renders them as a
   * read-only display so the user at least sees the current binding.
   */
  kind: PrimitiveKind | "enum" | "unsupported";
  /**
   * For enums, the qualified type name (e.g. `Modelica.Blocks.Types.Init`)
   * so we can emit `<typeName>.<leaf>` as the value expression.
   */
  enumTypeName?: string;
  /** Dialog tab / group — defaults to Modelica spec ("General" / "Parameters"). */
  tab: string;
  group: string;
  /**
   * Qualified TypeName of the ancestor that *declares* this parameter,
   * when it's reached through `extends` rather than declared on the host
   * class itself. Set only for inherited params; absent for the host's
   * own declarations. The submit handler routes inherited writes through
   * `setExtendsModifierValue(host, inheritedFrom, name, expr)` so the
   * modifier lands on the `extends` clause (matching OMEdit's
   * `mInherited` routing), not as a spurious host-level modifier.
   */
  inheritedFrom?: string;
}

export interface ClassParameterForm {
  schema: JsonSchema;
  values: Record<string, unknown>;
  /** Per-property metadata keyed by name; used by the submit translator. */
  refs: Record<string, ClassParameterRef>;
}

/**
 * Walk the class's extends chain in post-order and emit one schema
 * property per scalar/enum parameter encountered (ancestors first,
 * host last). A host-class redeclaration overwrites the inherited
 * entry by name. Returns `undefined` if no editable parameters were
 * found anywhere in the chain — the caller should show a "no
 * parameters" hint rather than open an empty modal.
 */
export function buildClassParameterForm(
  instance: ModelInstance,
): ClassParameterForm | undefined {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const values: Record<string, unknown> = {};
  const refs: Record<string, ClassParameterRef> = {};
  const requiredSet = new Set<string>();

  for (const klass of walkExtendsChain(instance)) {
    // The host class is `instance` itself (last in the post-order walk).
    // Anything yielded earlier is an ancestor reached via `extends`, so
    // its parameters are inherited and must be written back through the
    // extends clause. `klass === instance` is identity-safe because the
    // walker yields the same object references it traversed.
    const inheritedFrom = klass === instance ? undefined : klass.name;
    for (const el of klass.elements ?? []) {
      if (el.$kind !== "component") continue;
      if (el.prefixes?.variability !== "parameter") continue;
      const built = buildField(el, inheritedFrom);
      properties[el.name] = built.schema;
      refs[el.name] = built.ref;
      if (built.value !== undefined) {
        values[el.name] = built.value;
      } else {
        delete values[el.name];
      }
      // Parameters always have a binding (either inherited default or the
      // user's modifier) so they're "required" in the form sense — the
      // submit button stays enabled even without edits. We exclude the
      // unsupported (read-only) kind because the form can't fulfil their
      // required-ness via an edit. Deduped against host-class overrides
      // through the set.
      if (built.ref.kind !== "unsupported") {
        requiredSet.add(el.name);
      } else {
        requiredSet.delete(el.name);
      }
    }
  }
  for (const name of requiredSet) required.push(name);

  if (Object.keys(properties).length === 0) return undefined;
  return {
    schema: { type: "object", properties, required },
    values,
    refs,
  };
}

/**
 * Post-order walk over `mi` and its `extends` ancestors. Mirrors the
 * producer's `walkExtendsChain` (kept inline here to avoid pulling a
 * cross-package internal into the extension's public-facing surface).
 * Ancestors are yielded first, host last, matching Modelica flattening
 * order — callers can use last-write-wins to implement override
 * semantics.
 */
function* walkExtendsChain(mi: ModelInstance): Iterable<ModelInstance> {
  for (const e of mi.elements ?? []) {
    if (e.$kind === "extends" && typeof e.baseClass === "object") {
      yield* walkExtendsChain(e.baseClass);
    }
  }
  yield mi;
}

interface BuiltField {
  schema: JsonSchema;
  value: unknown;
  ref: ClassParameterRef;
}

/**
 * `inheritedFrom` is the qualified name of the ancestor declaring `el`
 * when it's reached through `extends` (undefined for the host's own
 * params). It's threaded onto the ref so the submit handler can route
 * the write through the extends clause. We pass it explicitly here
 * (vs. mutating the ref after the fact) so the `optionalField` helper
 * keeps the key absent when undefined — tests assert exact ref shape.
 */
function buildField(
  el: ComponentElement,
  inheritedFrom: string | undefined,
): BuiltField {
  const description = el.comment ?? undefined;
  const dialog: DialogInfo = readDialogInfo(el.annotation);
  const enumLeaves = enumLeavesIfEnum(el.type);
  if (enumLeaves) {
    const qualified = typeQualifiedName(el.type);
    if (qualified) {
      const schema: JsonSchema = {
        type: "string",
        enum: enumLeaves,
        ...dialogSchemaExt(dialog),
        "x-modelica-enum-type": qualified,
      };
      if (description) schema.description = description;
      return {
        schema,
        value: enumCurrentLeaf(el, qualified),
        ref: {
          name: el.name,
          kind: "enum",
          enumTypeName: qualified,
          tab: dialog.tab,
          group: dialog.group,
          ...inheritedRefField(inheritedFrom),
        },
      };
    }
    // Fall through to "unsupported" if the enum has no qualified name.
  }
  const primitive = resolvePrimitive(el.type);
  if (primitive) {
    const schema: JsonSchema = {
      type: primitive,
      ...dialogSchemaExt(dialog),
      ...unitSchemaExt(el),
    };
    if (description) schema.description = description;
    return {
      schema,
      value: currentPrimitiveValue(el, primitive),
      ref: {
        name: el.name,
        kind: primitive,
        tab: dialog.tab,
        group: dialog.group,
        ...inheritedRefField(inheritedFrom),
      },
    };
  }
  // Unsupported (record / array / complex). Emit a property with no
  // `type` (so `parameter-fields.ts` classifies it as "unsupported")
  // and let the form display the current binding read-only.
  const display = renderCurrentBinding(el);
  const schema: JsonSchema = {
    default: display,
    ...dialogSchemaExt(dialog),
  };
  if (description) schema.description = description;
  return {
    schema,
    value: display,
    ref: {
      name: el.name,
      kind: "unsupported",
      tab: dialog.tab,
      group: dialog.group,
      ...inheritedRefField(inheritedFrom),
    },
  };
}

/**
 * Spread helper so the `inheritedFrom` key is present only for inherited
 * params — keeps own-param refs free of the key (cleaner equality in
 * tests and on the wire).
 */
function inheritedRefField(
  inheritedFrom: string | undefined,
): { inheritedFrom?: string } {
  return inheritedFrom === undefined ? {} : { inheritedFrom };
}

/**
 * Project-internal extension keys carried on the schema property:
 *   - `x-modelica-tab` / `x-modelica-group` for layout grouping
 *   - `x-modelica-enable` for the form's evaluator (raw Expression AST,
 *     re-evaluated per field-change against the working values; undef
 *     means "always enabled" so we omit the key when there's no
 *     condition to evaluate).
 */
function dialogSchemaExt(d: DialogInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {
    "x-modelica-tab": d.tab,
    "x-modelica-group": d.group,
  };
  if (d.enable !== undefined) {
    out["x-modelica-enable"] = d.enable;
  }
  return out;
}

/**
 * Resolve the current value of an enum-typed parameter to its leaf
 * (e.g. `"PI"`), stripping the qualified type prefix so the picker
 * options match. The evaluated form is preferred (`value.binding`
 * carries a tagged `enum` literal); we fall back to parsing `modifiers`
 * as a string `<qualified>.<leaf>` when the binding isn't evaluated.
 */
function enumCurrentLeaf(
  el: ComponentElement,
  qualified: string,
): string | undefined {
  const binding = readValueBinding(el.value);
  if (binding && typeof binding === "object" && !Array.isArray(binding)) {
    const tagged = binding as { $kind?: unknown; name?: unknown };
    if (tagged.$kind === "enum" && typeof tagged.name === "string") {
      return stripPrefix(tagged.name, qualified);
    }
  }
  const mod = el.modifiers;
  if (typeof mod === "string") return stripPrefix(mod, qualified);
  return undefined;
}

/**
 * Pull the current value for a scalar parameter. Preference order:
 *   1. `value.value`  — evaluated literal OMC computed for us
 *   2. `value.binding` — only if it's already a primitive (numbers,
 *      booleans, plain strings) — tagged expressions like `binary_op`
 *      get reduced to `undefined` so the form falls back to its default.
 *   3. `modifiers`     — the raw user-written expression text. Quoted
 *      string literals (`"\"foo\""`) are unwrapped for the `string` kind.
 */
function currentPrimitiveValue(
  el: ComponentElement,
  kind: PrimitiveKind,
): unknown {
  const evaluated = readValueLiteral(el.value);
  if (evaluated !== undefined) return coerceToKind(evaluated, kind);
  const binding = readValueBinding(el.value);
  if (
    typeof binding === "number" ||
    typeof binding === "boolean" ||
    typeof binding === "string"
  ) {
    return coerceToKind(binding, kind);
  }
  const mod = el.modifiers;
  if (typeof mod === "string") {
    return coerceToKind(kind === "string" ? unquoteString(mod) : mod, kind);
  }
  return undefined;
}

function readValueLiteral(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return (value as { value?: unknown }).value;
}

function readValueBinding(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return (value as { binding?: unknown }).binding;
}

export function classParameterValueToExpr(
  ref: ClassParameterRef,
  value: unknown,
): string {
  return valueToExpr(ref.kind, value, ref.enumTypeName);
}
