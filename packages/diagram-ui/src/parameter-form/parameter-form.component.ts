/**
 * `<om-parameter-form>` — DIY JSON Schema form renderer for the small
 * field vocabulary OMC produces (`string`, `number`, `integer`,
 * `boolean`, `enum`, `array of scalar`).
 *
 * Stays vocabulary-narrow on purpose. Modelica parameter / simulation-
 * option schemas don't use `anyOf`, conditional schemas, refs, or nested
 * objects — supporting them would mean rolling a general-purpose form
 * engine, which the project rejected after the `@jsfe/form` spike.
 *
 * Inputs:
 *   - `schema`   (property)   — JSON Schema 2020-12 object node
 *   - `values`   (property)   — initial field values (Record<string, unknown>)
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

import type { JsonSchema } from "@modelica-wrapper/omc-client";

import { omTokens } from "../base/om-tokens.js";

import {
  initialValuesFromFields,
  isComplete,
  isFieldEnabled,
  parameterFieldsFromSchema,
  type ParameterField,
  type FieldKind,
} from "./parameter-fields.js";

interface GroupBucket {
  /** Group name from Dialog annotation, or `undefined` when the source
   *  schema didn't set one (e.g. the curated simulate form). */
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
  // user-defined "General" tab so a Dialog-using schema that omits tab
  // on some fields still groups them under "General" via the builder's
  // default, and a non-Dialog schema (simulate) gets the single bucket.
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

type Schema = JsonSchema;

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

  /** JSON Schema object node — assigned via the property API (not an attribute). */
  @property({ attribute: false })
  schema: Schema | undefined = undefined;

  /** Initial values for the form, keyed by property name. */
  @property({ attribute: false })
  values: Record<string, unknown> = {};

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

  override willUpdate(changed: Map<string | number | symbol, unknown>): void {
    if (changed.has("schema") || changed.has("values")) {
      this.fields = this.schema ? parameterFieldsFromSchema(this.schema) : [];
      this.working = initialValuesFromFields(this.fields, this.values);
      this.committed = { ...this.working };
      this.dirty = new Set();
    }
  }

  override render(): TemplateResult {
    const canSubmit = isComplete(this.fields, this.working);
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
              >${this.resetLabel}</wa-button>`
            : nothing}
          <wa-button
            type="button"
            variant="neutral"
            appearance="outlined"
            @click=${this.onCancel}
          >${this.cancelLabel}</wa-button>
          <wa-button
            type="submit"
            variant="brand"
            appearance="filled"
            ?disabled=${!canSubmit}
          >${this.submitLabel}</wa-button>
        </div>
      </form>
    `;
  }

  /**
   * Pick a layout based on the field metadata:
   *  - Multiple distinct Dialog tabs → render `<wa-tab-group>` with one
   *    panel per tab; inside each panel, group by Dialog group.
   *  - Single tab but multiple groups → flat list with group headers.
   *  - No tab/group metadata at all (e.g. the curated simulate form) →
   *    plain flat list, preserves the original layout.
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
          (b, i) => html`<wa-tab slot="nav" panel=${`tab-${i}`}
            >${b.tab}</wa-tab>`,
        )}
        ${buckets.map(
          (b, i) => html`<wa-tab-panel name=${`tab-${i}`}
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
          ${this.renderControl(f, enabled)}
        </div>
      `;
    }
    return html`
      <div class="field row" ?data-disabled=${!enabled}>
        <label class="label" for=${`f-${f.name}`}
          >${f.name}${f.required ? html`<span class="required">*</span>` : nothing}</label
        >
        <div class="control">${this.renderControl(f, enabled)}</div>
        ${f.description
          ? html`<div class="description">${f.description}</div>`
          : nothing}
      </div>
    `;
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
              (opt) => html`<wa-option value=${String(opt)}
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
              const n = f.kind === "integer" ? parseInt(text, 10) : Number(text);
              this.setField(f.name, Number.isFinite(n) ? n : undefined);
            }}
            @change=${() => this.commitEnable()}
          >${this.renderLabelSlot(f)}${this.renderHintSlot(f)}</wa-input>
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
          >${this.renderLabelSlot(f)}${this.renderHintSlot(f)}</wa-input>
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
          >${this.renderLabelSlot(f)}${this.renderHintSlot(f)}</wa-input>
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
    if (!isComplete(this.fields, this.working)) return;
    this.dispatchEvent(
      new CustomEvent<ParameterFormSubmitDetail>("om-parameter-submit", {
        detail: { values: { ...this.working } },
        bubbles: true,
        composed: true,
      }),
    );
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
  const parts = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
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
