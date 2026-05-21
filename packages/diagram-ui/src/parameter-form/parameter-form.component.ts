/**
 * `<om-parameter-form>` — typed `ParameterModel` form renderer for the small
 * field vocabulary the producers emit (`string`, `number`, `integer`,
 * `boolean`, `enum`, plus a read-only `unsupported` fallback).
 *
 * Renders omc-client's `ParameterModel` directly — no JSON Schema, no
 * `x-modelica-*` keys (see `docs/parameter-model-design.md`, Revision
 * 2026-05-21). Stays vocabulary-narrow on purpose: Modelica parameter /
 * simulate-setup models are flat scalar/enum lists, so the form maps each
 * field onto a single widget rather than rolling a general-purpose form engine.
 *
 * Inputs:
 *   - `model`    (property)   — omc-client `ParameterModel` (fields + values)
 *   - `title`    (attribute)  — optional heading rendered above the form
 *   - `submit-label` (attr)   — text for the submit button (default "Apply")
 *   - `cancel-label` (attr)   — text for the cancel button (default "Cancel")
 *   - `show-reset` (attr)     — when set, render a "Reset to defaults"
 *     button to the left of cancel/submit (default off — only the
 *     component parameter modal opts in)
 *   - `reset-label` (attr)    — text for the reset button
 *     (default "Reset to defaults")
 *
 * Events:
 *   - `om-parameter-change`  — fires on each field edit
 *     `detail: { values: Record<string, unknown>, dirty: Set<string> }`
 *   - `om-parameter-submit`  — fires on submit-button click (validates
 *     required fields client-side first)
 *     `detail: { values: Record<string, unknown> }`
 *   - `om-parameter-cancel`  — fires on cancel-button click
 *     `detail: {}`
 *   - `om-parameter-reset`   — fires on reset-button click (only emitted
 *     when `show-reset` is set). The host bulk-clears the component's
 *     modifiers and re-opens the form; the button carries no payload
 *     because the host already knows which component the modal targets.
 *     `detail: {}`
 *
 * Styling:
 *   - All colours / sizes are driven by `--vscode-*` CSS variables, so
 *     the panel inherits VSCode's current theme automatically when
 *     hosted in a webview. Stories provide fallback values so Storybook
 *     renders something sensible without VSCode.
 */

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import "@awesome.me/webawesome/dist/components/button/button.js";
import "@awesome.me/webawesome/dist/components/checkbox/checkbox.js";
import "@awesome.me/webawesome/dist/components/input/input.js";
import "@awesome.me/webawesome/dist/components/option/option.js";
import "@awesome.me/webawesome/dist/components/select/select.js";
import "@awesome.me/webawesome/dist/components/tab/tab.js";
import "@awesome.me/webawesome/dist/components/tab-group/tab-group.js";
import "@awesome.me/webawesome/dist/components/tab-panel/tab-panel.js";

import type { ParameterModel } from "@modelica-wrapper/omc-client";

import { omTokens } from "../base/om-tokens.js";

import {
  enabledValues,
  initialValuesFromFields,
  isComplete,
  isFieldEnabled,
  parameterFieldsFromModel,
  type ParameterField,
  type FieldKind,
} from "./parameter-fields.js";
import {
  backConvertToBaseUnit,
  convertShownValue,
  unitWidgetForField,
} from "./unit-display.js";

interface GroupBucket {
  /** Group name from the Dialog annotation. The producers always set a
   *  group (spec §18.7 default), so this is normally defined. */
  group: string | undefined;
  fields: ParameterField[];
}

interface TabBucket {
  tab: string;
  groups: GroupBucket[];
}

/**
 * Bucket fields by Dialog tab → group, preserving declaration order for
 * both tabs and groups (and fields within a group). Fields with no
 * `tab` AND no `group` collapse into a single un-named bucket so a
 * schema lacking Dialog metadata (simulate) renders flat.
 */
function bucketByTab(fields: ReadonlyArray<ParameterField>): TabBucket[] {
  const tabOrder: string[] = [];
  const byTab = new Map<string, Map<string | undefined, ParameterField[]>>();
  // Sentinel for "no tab metadata anywhere" — kept distinct from the
  // user-defined "General" tab so a model that omits tab on some fields
  // still groups them under "General" via the producer's default.
  const NO_TAB = "";
  for (const f of fields) {
    const tab = f.tab ?? NO_TAB;
    if (!byTab.has(tab)) {
      byTab.set(tab, new Map());
      tabOrder.push(tab);
    }
    const groups = byTab.get(tab)!;
    const groupKey = f.group;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(f);
  }
  return tabOrder.map((tab) => {
    const groupsMap = byTab.get(tab)!;
    const groups: GroupBucket[] = [];
    for (const [group, list] of groupsMap.entries()) {
      groups.push({ group, fields: list });
    }
    return { tab, groups };
  });
}

export interface ParameterFormChangeDetail {
  values: Record<string, unknown>;
  dirty: ReadonlySet<string>;
}

export interface ParameterFormSubmitDetail {
  values: Record<string, unknown>;
}

@customElement("om-parameter-form")
export class OmParameterForm extends LitElement {
  static override styles = [
    omTokens,
    css`
      :host {
        display: block;
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: var(--vscode-font-size, 13px);
        color: var(--vscode-foreground, #1f1f1f);
        padding: var(--om-space-lg) var(--om-space-xl);
        box-sizing: border-box;
      }

      .title {
        font-weight: 600;
        margin: 0 0 var(--om-space-lg) 0;
        font-size: var(--om-title-size);
      }

      .field {
        margin-bottom: var(--om-space-sm);
      }

      .field[data-disabled] {
        opacity: var(--om-disabled-opacity);
      }

      /* Horizontal label layout for wa-input / wa-select. Mirrors the
       * WA docs example for "Customizing Label Position": override the
       * host's vertical stacking with a grid, then style the label part
       * (WA exposes it as form-control-label). The hint reflows under
       * the input by snapping back into the second column. */
      .field wa-input,
      .field wa-select {
        display: grid;
        grid-template-columns: var(--om-form-label-width) 1fr;
        align-items: center;
        column-gap: var(--om-space-md);
        row-gap: var(--om-space-2xs);
      }

      .field wa-input::part(form-control-label),
      .field wa-select::part(form-control-label) {
        text-align: right;
        color: var(--vscode-descriptionForeground, #555);
      }

      .field wa-input::part(hint),
      .field wa-select::part(hint) {
        grid-column: 2 / 3;
        color: var(--vscode-descriptionForeground, #777);
        font-size: var(--om-description-size);
        line-height: 1.3;
      }

      /* Checkbox + unsupported rows can't use wa-input's internal label,
       * so they reuse the same column layout via an external grid. */
      .field.row {
        display: grid;
        grid-template-columns: var(--om-form-label-width) 1fr;
        align-items: center;
        column-gap: var(--om-space-md);
        row-gap: var(--om-space-2xs);
      }

      .field.row > .label {
        color: var(--vscode-descriptionForeground, #555);
        text-align: right;
      }

      .field.row > .description {
        grid-column: 2 / 3;
        color: var(--vscode-descriptionForeground, #777);
        font-size: var(--om-description-size);
        line-height: 1.3;
      }

      /* Input + unit widget on one row. The input grows; the unit suffix
       * / dropdown sits flush to its right. The wa-input keeps its own
       * internal label/value grid (the .field wa-input rule above still
       * matches it as a descendant). Top-align so the unit lines up with
       * the value row rather than centering against the wa-input's full
       * height (which also spans the reflowed description hint below). */
      .with-unit {
        display: flex;
        align-items: flex-start;
        gap: var(--om-space-sm);
      }
      .with-unit > wa-input,
      .with-unit > wa-select {
        flex: 1 1 auto;
        min-width: 0;
      }

      /* Static unit suffix label (single-option / fallback). */
      .unit-suffix {
        flex: 0 0 auto;
        color: var(--vscode-descriptionForeground, #777);
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: var(--om-description-size);
        white-space: nowrap;
      }

      /* Unit dropdown (≥2 options). Pinned to a fixed width so it hugs the
       * value control instead of stretching. The selector is deliberately
       * more specific than .with-unit > wa-select (flex: 1 1 auto) and
       * .field wa-select (display: grid) above so those don't win and
       * blow the width out; flex: 0 0 + an explicit width make the size
       * fully deterministic regardless of WA's intrinsic select sizing. */
      .with-unit > wa-select.unit-select {
        flex: 0 0 var(--om-unit-select-width);
        width: var(--om-unit-select-width);
        display: inline-block;
      }

      .required {
        color: var(--vscode-errorForeground, #c00);
        margin-left: var(--om-space-2xs);
      }

      .unsupported {
        color: var(--vscode-descriptionForeground, #777);
        font-style: italic;
      }

      /* Read-only display widget for non-editable (record / complex)
       * parameters. Sized to match the xs inputs so the control column
       * stays visually consistent across rows. */
      .readonly-display {
        display: inline-block;
        width: 100%;
        padding: var(--om-space-2xs) var(--om-space-sm);
        background: var(--vscode-input-background, #f3f3f3);
        color: var(--vscode-foreground, #1f1f1f);
        border: 1px solid var(--vscode-input-border, #d4d4d4);
        border-radius: var(--om-radius-sm, 4px);
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: var(--om-description-size);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .group {
        margin-top: var(--om-space-lg);
      }
      .group:first-child {
        margin-top: 0;
      }
      .group-title {
        font-weight: 600;
        font-size: var(--om-description-size);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--vscode-descriptionForeground, #666);
        margin: 0 0 var(--om-space-sm) 0;
        padding-bottom: var(--om-space-xs);
        border-bottom: 1px solid var(--vscode-input-border, #e0e0e0);
      }

      wa-tab-panel {
        padding-top: var(--om-space-md);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--om-space-md);
        margin-top: var(--om-space-lg);
      }

      /* Push the reset button to the far left so it reads as a separate,
       * destructive-ish affordance away from the primary cancel/submit
       * pair (mirrors OMEdit's "Restore Defaults" placement). */
      .actions .reset {
        margin-right: auto;
      }
    `,
  ];

  /** The parameter model to render — assigned via the property API. */
  @property({ attribute: false })
  model: ParameterModel | undefined = undefined;

  @property() title = "";
  @property({ attribute: "submit-label" }) submitLabel = "Apply";
  @property({ attribute: "cancel-label" }) cancelLabel = "Cancel";

  /**
   * When `true`, render a "Reset to defaults" button. The component
   * parameter modal sets this so the user can bulk-clear the
   * sub-component's modifiers; the class-level and simulate forms leave
   * it off (their reset semantics differ / aren't wired).
   */
  @property({ type: Boolean, attribute: "show-reset" }) showReset = false;
  @property({ attribute: "reset-label" }) resetLabel = "Reset to defaults";

  /**
   * Optional cref-prefix to strip when evaluating `Dialog.enable`
   * expressions. Component-level parameter forms set this to the
   * owning sub-component name so `PI.controllerType` in the
   * expression resolves against the form's `controllerType` working
   * value. Class-level forms leave it unset.
   *
   * Named `crefPrefix` rather than `prefix` because `prefix` is taken
   * by DOM's `Element.prefix` (XML namespace).
   */
  @property({ attribute: "cref-prefix" })
  crefPrefix: string | undefined = undefined;

  /** Tracks fields the user has actually touched — used by `change` payload. */
  @state()
  private dirty: Set<string> = new Set();

  /** Live editing state, seeded from props in `updated()`. */
  @state()
  private working: Record<string, unknown> = {};

  /**
   * Snapshot of committed values used to evaluate `Dialog.enable`.
   * Distinct from `working` so the enabled/disabled gating only
   * re-evaluates on field commit (focus-out / `change`), not on every
   * keystroke — matching OMEdit, whose `eventFilter` re-evaluates enable
   * only on `QEvent::FocusOut`
   * (`OMEdit/OMEditLIB/Element/ElementProperties.cpp:1178-1188`). Text /
   * number inputs update `working` live on `input` but only refresh this
   * snapshot on `change`; checkbox / select commit on `change` directly,
   * so for them the two move together.
   */
  @state()
  private committed: Record<string, unknown> = {};

  /** Cached field list — re-derived only when `schema` or `values` change. */
  @state()
  private fields: ParameterField[] = [];

  /**
   * Per-field currently-selected display unit. Seeded from each field's
   * default-selected unit (its `displayUnit` when it differs from `unit`,
   * else the base `unit`); updated when the user picks from the unit
   * dropdown. The `working` value is kept expressed in the selected unit
   * so the number the user sees and the suffix/dropdown agree.
   *
   * On submit, `onSubmit` converts each such field's value BACK to its base
   * declaration `unit` before emitting (see `onSubmit`), so the host always
   * receives base-unit values and its strict-equality diff stays correct —
   * an unedited `deg`-shown / `rad`-base field writes nothing. (Writing a
   * `displayUnit` modifier so the choice persists across reopen is a
   * separate follow-up; see the PR.)
   */
  @state()
  private unitSelection: Record<string, string> = {};

  /**
   * Snapshot of the base-unit initial values (before display-unit
   * conversion), keyed by field name. Used by `submitValues` to snap an
   * unedited display-unit field back to its exact original base value so a
   * no-op Apply writes nothing. Rebuilt whenever the model changes.
   */
  private baseInitialValues: Record<string, unknown> = {};

  override willUpdate(changed: Map<string | number | symbol, unknown>): void {
    if (changed.has("model")) {
      this.fields = this.model ? parameterFieldsFromModel(this.model) : [];
      this.working = initialValuesFromFields(this.fields);
      this.baseInitialValues = { ...this.working };
      this.seedUnitSelection();
      this.committed = { ...this.working };
      this.dirty = new Set();
    }
  }

  /**
   * Seed the per-field display-unit map and re-express each affected
   * field's initial value in its default-selected unit.
   *
   * Only fields whose unit widget is a DROPDOWN get an entry (a static
   * suffix has no selectable state). The base value from OMC is in the
   * declaration `unit`; when the default selection is a different unit
   * (e.g. `displayUnit = "deg"` for a `rad` angle) we convert the shown
   * value into it so the number and the dropdown agree on open — matching
   * OMEdit, which default-selects `displayUnit` and shows the converted
   * value. Mutates `this.working` in place (it was just rebuilt above).
   */
  private seedUnitSelection(): void {
    const selection: Record<string, string> = {};
    for (const f of this.fields) {
      const widget = unitWidgetForField(f);
      if (widget.kind !== "dropdown") continue;
      selection[f.name] = widget.selected;
      // Initial value arrives in the base `unit`; convert to the selected
      // unit if they differ so the displayed number matches the dropdown.
      const base = f.unit?.trim();
      if (base && base !== widget.selected) {
        const v = this.working[f.name];
        if (typeof v === "number") {
          const converted = convertShownValue(
            v,
            base,
            widget.selected,
            f.unitOptions,
          );
          if (converted !== undefined) this.working[f.name] = converted;
        }
      }
    }
    this.unitSelection = selection;
  }

  override render(): TemplateResult {
    const canSubmit = isComplete(this.fields, this.working, this.crefPrefix);
    return html`
      ${this.title ? html`<h3 class="title">${this.title}</h3>` : nothing}
      <form @submit=${this.onSubmit}>
        ${this.renderBody()}
        <div class="actions">
          ${this.showReset
            ? html`<wa-button
                class="reset"
                type="button"
                variant="neutral"
                appearance="outlined"
                @click=${this.onReset}
                >${this.resetLabel}</wa-button
              >`
            : nothing}
          <wa-button
            type="button"
            variant="neutral"
            appearance="outlined"
            @click=${this.onCancel}
            >${this.cancelLabel}</wa-button
          >
          <wa-button
            type="submit"
            variant="brand"
            appearance="filled"
            ?disabled=${!canSubmit}
            >${this.submitLabel}</wa-button
          >
        </div>
      </form>
    `;
  }

  /**
   * Pick a layout based on the field metadata:
   *  - Multiple distinct Dialog tabs → render `<wa-tab-group>` with one
   *    panel per tab; inside each panel, group by Dialog group.
   *  - Single tab but multiple groups → flat list with group headers.
   *  - A single un-named group → plain flat list (no header noise).
   */
  private renderBody(): TemplateResult {
    const buckets = bucketByTab(this.fields);
    if (buckets.length <= 1) {
      const single = buckets[0];
      if (!single) return html`${nothing}`;
      return this.renderGroups(single.groups);
    }
    return html`
      <wa-tab-group placement="top">
        ${buckets.map(
          (b, i) =>
            html`<wa-tab slot="nav" panel=${`tab-${i}`}>${b.tab}</wa-tab>`,
        )}
        ${buckets.map(
          (b, i) =>
            html`<wa-tab-panel name=${`tab-${i}`}
              >${this.renderGroups(b.groups)}</wa-tab-panel
            >`,
        )}
      </wa-tab-group>
    `;
  }

  private renderGroups(groups: GroupBucket[]): TemplateResult {
    // Suppress the group header when there's only one un-named group —
    // a single "Parameters" header above a 3-field form is just noise.
    const only = groups.length === 1 ? groups[0] : undefined;
    if (only && only.group === undefined) {
      return html`${only.fields.map((f) => this.renderField(f))}`;
    }
    return html`${groups.map(
      (g) => html`
        <div class="group">
          ${g.group !== undefined
            ? html`<div class="group-title">${g.group}</div>`
            : nothing}
          ${g.fields.map((f) => this.renderField(f))}
        </div>
      `,
    )}`;
  }

  private renderField(f: ParameterField): TemplateResult {
    const enabled = this.isFieldEnabled(f);
    // wa-input / wa-select host the label and hint internally (so WA's
    // form-control-label part can position them adjacent to the input);
    // wa-checkbox and the read-only "unsupported" display still need an
    // external row that aligns with the same label column.
    const hasInternalLabel = f.kind !== "boolean" && f.kind !== "unsupported";
    if (hasInternalLabel) {
      return html`
        <div class="field" ?data-disabled=${!enabled}>
          ${this.renderControlWithUnit(f, enabled)}
        </div>
      `;
    }
    return html`
      <div class="field row" ?data-disabled=${!enabled}>
        <label class="label" for=${`f-${f.name}`}
          >${f.name}${f.required
            ? html`<span class="required">*</span>`
            : nothing}</label
        >
        <div class="control">${this.renderControlWithUnit(f, enabled)}</div>
        ${f.description
          ? html`<div class="description">${f.description}</div>`
          : nothing}
      </div>
    `;
  }

  /**
   * Render a field's value control, wrapping it with its unit widget (a
   * suffix label or unit dropdown) in a flex row to the control's right
   * when the field carries one. Unit-less fields render the bare control
   * so the layout is unchanged for them.
   */
  private renderControlWithUnit(
    f: ParameterField,
    enabled: boolean,
  ): TemplateResult {
    const unit = this.renderUnitWidget(f, enabled);
    if (unit === nothing) return this.renderControl(f, enabled);
    return html`<div class="with-unit">
      ${this.renderControl(f, enabled)}${unit}
    </div>`;
  }

  /** Reusable label + hint slot content for wa-input / wa-select. */
  private renderLabelSlot(f: ParameterField): TemplateResult {
    return html`<span slot="label"
      >${f.name}${f.required
        ? html`<span class="required">*</span>`
        : nothing}</span
    >`;
  }

  private renderHintSlot(f: ParameterField): TemplateResult {
    return f.description
      ? html`<span slot="hint">${f.description}</span>`
      : html`${nothing}`;
  }

  /**
   * Render the unit widget for a field, to the right of its value control:
   *   - `none`     → nothing (unit-less parameter)
   *   - `suffix`   → a static `kg.m2`-style label (single option / fallback)
   *   - `dropdown` → a `<wa-select>` of unit choices (≥2 options); on
   *     change, the shown value is converted in place with the
   *     pre-shipped factors (synchronous, no OMC round-trip).
   *
   * Returns `nothing` for the `none` case so `renderField` can skip the
   * flex wrapper entirely. The dropdown is gated by the field's enabled
   * state so a disabled row's unit picker is disabled too.
   */
  private renderUnitWidget(
    f: ParameterField,
    enabled: boolean,
  ): TemplateResult | typeof nothing {
    const widget = unitWidgetForField(f);
    switch (widget.kind) {
      case "none":
        return nothing;
      case "suffix":
        return html`<span class="unit-suffix" title=${widget.unit}
          >${widget.unit}</span
        >`;
      case "dropdown": {
        const selected = this.unitSelection[f.name] ?? widget.selected;
        return html`
          <wa-select
            class="unit-select"
            size="xs"
            ?disabled=${!enabled}
            .value=${selected}
            @change=${(e: Event) => {
              const next = (e.target as HTMLElement & { value: string }).value;
              this.onUnitChange(f, next);
            }}
          >
            ${widget.options.map(
              (o) => html`<wa-option value=${o.unit}>${o.unit}</wa-option>`,
            )}
          </wa-select>
        `;
      }
    }
  }

  /**
   * Handle a unit-dropdown selection. Converts the field's current shown
   * value from the previously-selected unit into the newly-picked one
   * (with the pre-shipped affine factors), updates the working value, and
   * records the new selection. A non-numeric value or an unconvertible
   * pair leaves the value untouched (matching OMEdit, which disables
   * conversion for non-literal values) — only the selected unit changes.
   */
  private onUnitChange(f: ParameterField, nextUnit: string): void {
    const prevUnit = this.unitSelection[f.name] ?? f.unit ?? nextUnit;
    this.unitSelection = { ...this.unitSelection, [f.name]: nextUnit };
    const v = this.working[f.name];
    if (typeof v === "number" && prevUnit !== nextUnit) {
      const converted = convertShownValue(v, prevUnit, nextUnit, f.unitOptions);
      if (converted !== undefined) {
        // commit:true — the value moved, refresh the enable snapshot too.
        this.setField(f.name, converted, { commit: true });
        return;
      }
    }
    // No value change, but Lit needs a re-render to reflect the new
    // selection in the dropdown.
    this.requestUpdate();
  }

  /**
   * Evaluate the field's `Dialog.enable` against the *committed*
   * snapshot (not the live `working` set), so the gating only changes on
   * field commit (focus-out / `change`), not per keystroke — matching
   * OMEdit's focus-out re-evaluation
   * (`OMEdit/OMEditLIB/Element/ElementProperties.cpp:1178-1188`).
   *
   * Delegates to the pure helper in `parameter-fields.ts`, which also
   * applies the working → class-default → undefined value-fallback
   * precedence (`Annotations/DynamicAnnotation.cpp:222-242`).
   */
  private isFieldEnabled(f: ParameterField): boolean {
    return isFieldEnabled(f, this.fields, this.committed, this.crefPrefix);
  }

  private renderControl(f: ParameterField, enabled: boolean): TemplateResult {
    const v = this.working[f.name];
    switch (f.kind) {
      case "enum":
        // wa-select takes its value via the `.value` property (string
        // or array for `multiple`). Options live in light DOM as
        // wa-option children.
        return html`
          <wa-select
            id=${`f-${f.name}`}
            size="xs"
            ?disabled=${!enabled}
            .value=${v === undefined || v === null ? "" : String(v)}
            @change=${(e: Event) => {
              const next = (e.target as HTMLElement & { value: string }).value;
              // wa-select commits on `change`; refresh the enable
              // snapshot in the same step.
              this.setField(f.name, next === "" ? undefined : next, {
                commit: true,
              });
            }}
          >
            ${this.renderLabelSlot(f)}${this.renderHintSlot(f)}
            ${!f.required && !f.defaultValue
              ? html`<wa-option value=""></wa-option>`
              : nothing}
            ${f.enumValues.map(
              (opt) =>
                html`<wa-option value=${String(opt)}
                  >${String(opt)}</wa-option
                >`,
            )}
          </wa-select>
        `;
      case "boolean":
        return html`
          <wa-checkbox
            id=${`f-${f.name}`}
            size="xs"
            ?checked=${Boolean(v)}
            ?disabled=${!enabled}
            @change=${(e: Event) => {
              const checked = (e.target as HTMLElement & { checked: boolean })
                .checked;
              // wa-checkbox commits on `change`; refresh the enable
              // snapshot in the same step.
              this.setField(f.name, checked, { commit: true });
            }}
          ></wa-checkbox>
        `;
      case "number":
      case "integer":
        // wa-input accepts `step="any"` (typed `number | "any"`),
        // matching the native input's sentinel for "no stepping".
        // Without it, omitting `step` falls back to the default of
        // 1 — which rejects fractional values like `0.000001` for
        // the simulator's tolerance field.
        return html`
          <wa-input
            id=${`f-${f.name}`}
            type="number"
            size="xs"
            step=${f.kind === "integer" ? "1" : "any"}
            ?disabled=${!enabled}
            .value=${v === undefined || v === null ? "" : String(v)}
            @input=${(e: Event) => {
              const text = (e.target as HTMLElement & { value: string }).value;
              if (text === "") {
                this.setField(f.name, undefined);
                return;
              }
              const n =
                f.kind === "integer" ? parseInt(text, 10) : Number(text);
              this.setField(f.name, Number.isFinite(n) ? n : undefined);
            }}
            @change=${() => this.commitEnable()}
            >${this.renderLabelSlot(f)}${this.renderHintSlot(f)}</wa-input
          >
        `;
      case "array": {
        // Render as a comma-separated text input. OMC parameter arrays are
        // small (e.g. `r_CM[3]`) and the comma form is what most tools use
        // for hand-editing. We split on commas; downstream serialisation
        // is the caller's problem.
        const arr = Array.isArray(v) ? v : [];
        return html`
          <wa-input
            id=${`f-${f.name}`}
            type="text"
            size="xs"
            ?disabled=${!enabled}
            .value=${arr.map((x) => stringifyAtom(x)).join(", ")}
            placeholder=${`comma-separated ${f.itemKind ?? "string"} values`}
            @input=${(e: Event) =>
              this.setField(
                f.name,
                parseArrayInput(
                  (e.target as HTMLElement & { value: string }).value,
                  f.itemKind ?? "string",
                ),
              )}
            @change=${() => this.commitEnable()}
            >${this.renderLabelSlot(f)}${this.renderHintSlot(f)}</wa-input
          >
        `;
      }
      case "string":
        return html`
          <wa-input
            id=${`f-${f.name}`}
            type="text"
            size="xs"
            ?disabled=${!enabled}
            .value=${v === undefined || v === null ? "" : String(v)}
            @input=${(e: Event) =>
              this.setField(
                f.name,
                (e.target as HTMLElement & { value: string }).value,
              )}
            @change=${() => this.commitEnable()}
            >${this.renderLabelSlot(f)}${this.renderHintSlot(f)}</wa-input
          >
        `;
      case "unsupported": {
        // Record / complex parameters can't be edited yet, but we still
        // want the user to see what's currently bound. The builder
        // passes the rendered binding as `defaultValue` so we don't
        // need to know about Modelica shapes here.
        const text = stringifyAtom(v ?? f.defaultValue ?? "");
        return html`<span
          class="readonly-display"
          id=${`f-${f.name}`}
          title=${text}
          >${text === "" ? "(empty)" : text}</span
        >`;
      }
    }
  }

  /**
   * Update a field's live working value.
   *
   * `commit` controls whether the change also refreshes the `committed`
   * snapshot the `Dialog.enable` evaluator reads. Text / number / array
   * inputs leave it `false` on each `input` (keystroke) so sibling
   * gating doesn't strobe mid-typing, then commit on `change`
   * (focus-out). Checkbox / select have no keystroke phase — their only
   * event is `change`, which is itself the commit — so they pass
   * `commit: true`.
   */
  private setField(
    name: string,
    value: unknown,
    { commit = false }: { commit?: boolean } = {},
  ): void {
    // Use a fresh object so Lit's change detection picks it up; the
    // contract on `om-parameter-change` is that consumers can mutate the
    // returned `values` without mutating our internal state, so we hand
    // out a shallow clone.
    this.working = { ...this.working, [name]: value };
    this.dirty = new Set(this.dirty).add(name);
    if (commit) this.committed = { ...this.working };
    this.dispatchEvent(
      new CustomEvent<ParameterFormChangeDetail>("om-parameter-change", {
        detail: { values: { ...this.working }, dirty: this.dirty },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Refresh the `committed` snapshot from the live working values,
   * re-evaluating every field's `Dialog.enable`. Wired to the
   * focus-out / commit `change` event of text / number / array inputs
   * (which track their value live on `input`). Mirrors OMEdit's
   * focus-out re-evaluation
   * (`OMEdit/OMEditLIB/Element/ElementProperties.cpp:1178-1188`).
   */
  private commitEnable(): void {
    this.committed = { ...this.working };
  }

  private onSubmit(e: Event): void {
    e.preventDefault();
    if (!isComplete(this.fields, this.working, this.crefPrefix)) return;
    this.dispatchEvent(
      new CustomEvent<ParameterFormSubmitDetail>("om-parameter-submit", {
        // `submitValues()` emits base-unit values AND drops disabled fields
        // (issue #76, item 4) so we never write a stale binding the user can
        // no longer see.
        detail: { values: this.submitValues() },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Build the values object to emit on submit, expressed in each field's
   * BASE declaration `unit` rather than the selected display unit.
   *
   * `working` holds values in the user's SELECTED unit (seeded/converted by
   * `seedUnitSelection` / `onUnitChange`). The host diffs the submitted
   * values against the base-unit initials with strict equality and writes
   * the raw expression, so emitting selected-unit values would silently
   * corrupt every display-unit param (e.g. a `rad` param shown as `90 deg`
   * would write `90` meaning 90 rad). For each dropdown field we therefore
   * back-convert to the base `unit` via `backConvertToBaseUnit`, which also
   * SNAPS to the original base initial when the round-trip is within
   * tolerance — so opening a display-unit param and clicking Apply without
   * editing (or merely switching the dropdown) writes nothing. Non-dropdown
   * and base-unit-selected fields pass through unchanged.
   */
  private submitValues(): Record<string, unknown> {
    const out: Record<string, unknown> = { ...this.working };
    for (const f of this.fields) {
      const selected = this.unitSelection[f.name];
      const base = f.unit?.trim();
      // Only dropdown fields have a selection; skip when there's no base
      // unit, no divergence, or a non-numeric value (nothing to convert).
      if (!selected || !base || selected === base) continue;
      const v = this.working[f.name];
      if (typeof v !== "number") continue;
      out[f.name] = backConvertToBaseUnit(
        v,
        selected,
        base,
        this.baseInitialValues[f.name],
        f.unitOptions,
      );
    }
    // Drop disabled-field values (issue #76, item 4): OMEdit suppresses writes
    // for a field whose `Dialog.enable` is false, so a stale value left behind
    // when the user toggled a controller off must not be submitted.
    return enabledValues(this.fields, out, this.crefPrefix);
  }

  private onCancel(): void {
    this.dispatchEvent(
      new CustomEvent("om-parameter-cancel", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Emit `om-parameter-reset`. No payload: the host owns the modal's
   * target component name, so the form only signals intent. The host
   * bulk-clears and re-opens the form with refreshed values, which is
   * what makes the field controls reflect the reset.
   */
  private onReset(): void {
    this.dispatchEvent(
      new CustomEvent("om-parameter-reset", {
        bubbles: true,
        composed: true,
      }),
    );
  }
}

function stringifyAtom(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null || v === undefined) return "";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function parseArrayInput(raw: string, itemKind: FieldKind): unknown[] {
  if (raw.trim().length === 0) return [];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (itemKind === "number" || itemKind === "integer") {
    return parts.map((s) => {
      const n = itemKind === "integer" ? parseInt(s, 10) : Number(s);
      return Number.isFinite(n) ? n : s;
    });
  }
  if (itemKind === "boolean") {
    return parts.map((s) => s === "true");
  }
  return parts;
}

declare global {
  interface HTMLElementTagNameMap {
    "om-parameter-form": OmParameterForm;
  }
}
