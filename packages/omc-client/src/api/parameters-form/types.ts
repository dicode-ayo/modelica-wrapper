/**
 * Renderer-agnostic parameter model — sibling to `DiagramLayout`
 * (`_shared/diagramLayout.ts`).
 *
 * `produceParameterModel` (see `producer.ts`) is a pure function of a
 * `ModelInstance` (+ an optionally injected `UnitTable`) that emits one of
 * these. The extension adapts it into the webview `JsonSchema` the parameter
 * form already consumes; the diagram value-labels share the same
 * `ParameterField` facts + the same `UnitTable` conversion path.
 *
 * The shape deliberately mirrors the field vocabulary the form layer already
 * speaks — `parameter-fields.ts` `FieldKind`, `UnitOption`, the
 * `tab`/`group`/`enable` Dialog metadata — so the host-side adapter stays
 * thin and structurally compatible with the wire protocol (no protocol
 * change). The producer itself has NO OMC dependency.
 */

import type { Expression } from "../../_shared/modelInstance.js";

/**
 * The widget kind a field renders as. Same vocabulary as the diagram-ui
 * `FieldKind` and the extension's old `PrimitiveKind | "enum" | "unsupported"`
 * so the adapter is a 1:1 map.
 *
 *  - `string` / `number` / `integer` / `boolean` — scalar primitives
 *  - `enum` — an enumeration type; `enumChoices` carries the leaf names
 *  - `unsupported` — record / array / complex parameter we can't edit yet;
 *    surfaced read-only so the user still sees the current binding
 */
export type ParameterFieldKind =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "unsupported";

/**
 * A selectable unit choice for a parameter, with the affine conversion
 * needed to render a `unit`-valued number in this option's unit. Identical
 * shape to diagram-ui's `UnitOption` and the extension's old wire entry, so
 * the host can pass these straight through onto the schema.
 *
 * Conversion direction matches OMEdit / `convertUnits`:
 *
 *   shownValue = (sourceValue - offset) / scaleFactor
 *
 * The entry whose `unit === field.unit` is the identity option
 * (`scaleFactor = 1`, `offset = 0`).
 */
export interface UnitOption {
  /** The unit string this option selects (e.g. "deg", "rad"). */
  unit: string;
  /** Affine scale: `shown = (source - offset) / scaleFactor`. */
  scaleFactor: number;
  /** Affine offset: `shown = (source - offset) / scaleFactor`. */
  offset: number;
}

/**
 * Host-fetched, injected, deduplicated-by-base-unit table of unit options.
 *
 * The two facts the producer can't derive purely from the AST —
 * `getDerivedUnits(baseUnit)` (the alternative-unit list) and
 * `convertUnits(s1, s2)` (the affine factors) — live here. The host builds
 * it once (cached for the whole `OmcClient` session) and injects it; the
 * producer fills `ParameterField.unitOptions` from it.
 *
 * Keyed by the parameter's base `unit` (e.g. `"rad"`). Absent keys leave a
 * field's `unitOptions` empty (form renders a static suffix from `unit`).
 */
export type UnitTable = ReadonlyMap<string, ReadonlyArray<UnitOption>>;

/**
 * One editable (or read-only) parameter, walked from the (component's) type
 * extends chain.
 */
export interface ParameterField {
  /**
   * Relative parameter name (e.g. `"k"`). For component params the host
   * targets `<component>.<name>` on submit (the producer carries the
   * component name on `ParameterModel.component`); for class params it's the
   * property name == the host-class component name.
   */
  name: string;
  /** Display label — the declaration comment, else the name. */
  label: string;
  /** The widget kind to render. */
  kind: ParameterFieldKind;
  /**
   * Current value: the instance modifier when present, else the type
   * default. Coerced to the field's kind (number / boolean / string) where
   * possible; `null` when neither source carries a usable value.
   */
  value: Expression | string | number | boolean | null;
  /**
   * Type-declaration default (pre-instance-modifier), kept for
   * dirty-detection / reset-to-defaults. Absent when the declaration has no
   * default.
   */
  defaultValue?: Expression | string | number | boolean | undefined;
  /** Enumeration leaf names, in declaration order. Set only for `kind: "enum"`. */
  enumChoices?: string[] | undefined;
  /**
   * Qualified enumeration type name (e.g. `Modelica.Blocks.Types.Init`) for
   * `kind: "enum"`. Used to qualify a leaf value (`"PI"`) into the
   * `<typeName>.<leaf>` expression on submit and against Dialog.enable
   * literals.
   */
  enumTypeName?: string | undefined;
  /** Modelica `Dialog(...)` annotation facts. Tab / group always set (spec defaults). */
  dialog: {
    tab: string;
    group: string;
    /**
     * Raw `Dialog.enable` Expression AST when present. The form re-evaluates
     * it against the user's in-progress working values, so it stays unevaluated
     * here. `undefined` means "always enabled".
     */
    enable?: Expression | undefined;
  };
  /** Base unit from the AST (e.g. `"kg.m2"`, `"rad"`). Absent for unit-less params. */
  unit?: string | undefined;
  /** `displayUnit` modifier from the AST, if any (e.g. `"deg"`). */
  displayUnit?: string | undefined;
  /**
   * Direct extends base the parameter is inherited through (write routing for
   * class params via `setExtendsModifierValue`). Absent for the host class's
   * own declarations. For component params this is informational only — the
   * host always writes the dotted `<component>.<param>` path.
   */
  inheritedFrom?: string | undefined;
  /**
   * Unit choices + conversion factors, filled from an injected `UnitTable`.
   * Empty when no table was supplied or the param is unit-less. 1 entry →
   * static suffix; ≥2 → dropdown.
   */
  unitOptions: ReadonlyArray<UnitOption>;
}

/**
 * The parameter model for a class (or a sub-component's type). One field per
 * `variability == "parameter"` element across the extends chain.
 */
export interface ParameterModel {
  /** Qualified host class name (the class, or the sub-component's type). */
  className: string;
  /**
   * Sub-component instance name when this model describes a component's
   * parameters (the `<component>.<param>` write target prefix); unset for
   * class-level parameter models.
   */
  component?: string | undefined;
  /** Fields in walk order (ancestors first, host last; later-declared wins by name). */
  fields: ParameterField[];
}
