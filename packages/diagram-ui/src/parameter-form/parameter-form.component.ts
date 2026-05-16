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
 *
 * Events:
 *   - `om-parameter-change`  — fires on each field edit
 *     `detail: { values: Record<string, unknown>, dirty: Set<string> }`
 *   - `om-parameter-submit`  — fires on submit-button click (validates
 *     required fields client-side first)
 *     `detail: { values: Record<string, unknown> }`
 *   - `om-parameter-cancel`  — fires on cancel-button click
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

import type { JsonSchema } from "@modelica-wrapper/omc-client";

import { omTokens } from "../base/om-tokens.js";

import {
  initialValuesFromFields,
  isComplete,
  parameterFieldsFromSchema,
  type ParameterField,
  type FieldKind,
} from "./parameter-fields.js";

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
        display: grid;
        grid-template-columns: var(--om-form-label-width) 1fr;
        column-gap: var(--om-space-lg);
        row-gap: var(--om-space-xs);
        align-items: baseline;
        margin-bottom: var(--om-space-md);
      }

      .label {
        color: var(--vscode-descriptionForeground, #555);
        text-align: right;
      }

      .label .required {
        color: var(--vscode-errorForeground, #c00);
        margin-left: var(--om-space-2xs);
      }

      /* Make wa-input + wa-select stretch to fill the control column. */
      .control wa-input,
      .control wa-select {
        width: 100%;
      }

      .description {
        grid-column: 2 / 3;
        color: var(--vscode-descriptionForeground, #777);
        font-size: var(--om-description-size);
        line-height: 1.3;
      }

      .unsupported {
        color: var(--vscode-descriptionForeground, #777);
        font-style: italic;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--om-space-md);
        margin-top: var(--om-space-lg);
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

  /** Tracks fields the user has actually touched — used by `change` payload. */
  @state()
  private dirty: Set<string> = new Set();

  /** Live editing state, seeded from props in `updated()`. */
  @state()
  private working: Record<string, unknown> = {};

  /** Cached field list — re-derived only when `schema` or `values` change. */
  @state()
  private fields: ParameterField[] = [];

  override willUpdate(changed: Map<string | number | symbol, unknown>): void {
    if (changed.has("schema") || changed.has("values")) {
      this.fields = this.schema ? parameterFieldsFromSchema(this.schema) : [];
      this.working = initialValuesFromFields(this.fields, this.values);
      this.dirty = new Set();
    }
  }

  override render(): TemplateResult {
    const canSubmit = isComplete(this.fields, this.working);
    return html`
      ${this.title ? html`<h3 class="title">${this.title}</h3>` : nothing}
      <form @submit=${this.onSubmit}>
        ${this.fields.map((f) => this.renderField(f))}
        <div class="actions">
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

  private renderField(f: ParameterField): TemplateResult {
    return html`
      <div class="field">
        <label class="label" for=${`f-${f.name}`}
          >${f.name}${f.required ? html`<span class="required">*</span>` : nothing}</label
        >
        <div class="control">${this.renderControl(f)}</div>
        ${f.description
          ? html`<div class="description">${f.description}</div>`
          : nothing}
      </div>
    `;
  }

  private renderControl(f: ParameterField): TemplateResult {
    const v = this.working[f.name];
    switch (f.kind) {
      case "enum":
        // wa-select takes its value via the `.value` property (string
        // or array for `multiple`). Options live in light DOM as
        // wa-option children.
        return html`
          <wa-select
            id=${`f-${f.name}`}
            size="small"
            .value=${v === undefined || v === null ? "" : String(v)}
            @change=${(e: Event) => {
              const next = (e.target as HTMLElement & { value: string }).value;
              this.setField(f.name, next === "" ? undefined : next);
            }}
          >
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
            ?checked=${Boolean(v)}
            @change=${(e: Event) => {
              const checked = (e.target as HTMLElement & { checked: boolean })
                .checked;
              this.setField(f.name, checked);
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
            size="small"
            step=${f.kind === "integer" ? "1" : "any"}
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
          ></wa-input>
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
            size="small"
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
          ></wa-input>
        `;
      }
      case "string":
        return html`
          <wa-input
            id=${`f-${f.name}`}
            type="text"
            size="small"
            .value=${v === undefined || v === null ? "" : String(v)}
            @input=${(e: Event) =>
              this.setField(
                f.name,
                (e.target as HTMLElement & { value: string }).value,
              )}
          ></wa-input>
        `;
      case "unsupported":
        return html`<span class="unsupported"
          >(unsupported field type — read only)</span
        >`;
    }
  }

  private setField(name: string, value: unknown): void {
    // Use a fresh object so Lit's change detection picks it up; the
    // contract on `om-parameter-change` is that consumers can mutate the
    // returned `values` without mutating our internal state, so we hand
    // out a shallow clone.
    this.working = { ...this.working, [name]: value };
    this.dirty = new Set(this.dirty).add(name);
    this.dispatchEvent(
      new CustomEvent<ParameterFormChangeDetail>("om-parameter-change", {
        detail: { values: { ...this.working }, dirty: this.dirty },
        bubbles: true,
        composed: true,
      }),
    );
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
