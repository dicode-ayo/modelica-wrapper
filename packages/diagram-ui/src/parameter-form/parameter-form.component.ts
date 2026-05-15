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
        background: var(--vscode-editorWidget-background, #f3f3f3);
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

      .control input[type="text"],
      .control input[type="number"],
      .control textarea,
      .control select {
        width: 100%;
        box-sizing: border-box;
        padding: var(--om-input-padding);
        font: inherit;
        color: var(--vscode-input-foreground, inherit);
        background: var(--vscode-input-background, #fff);
        border: 1px solid var(--vscode-input-border, #ccc);
        border-radius: var(--om-radius-sm);
      }

      .control textarea {
        min-height: var(--om-textarea-min-height);
        resize: vertical;
      }

      .control input:focus,
      .control textarea:focus,
      .control select:focus {
        outline: 1px solid var(--vscode-focusBorder, #007fd4);
        outline-offset: -1px;
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

      button {
        font: inherit;
        padding: var(--om-button-padding);
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: var(--om-radius-sm);
        cursor: pointer;
      }

      button.primary {
        color: var(--vscode-button-foreground, #fff);
        background: var(--vscode-button-background, #0e639c);
      }

      button.primary:hover {
        background: var(--vscode-button-hoverBackground, #1177bb);
      }

      button.primary[disabled] {
        opacity: var(--om-disabled-opacity);
        cursor: not-allowed;
      }

      button.secondary {
        color: var(--vscode-button-secondaryForeground, inherit);
        background: var(--vscode-button-secondaryBackground, transparent);
      }

      button.secondary:hover {
        background: var(
          --vscode-button-secondaryHoverBackground,
          rgba(0, 0, 0, 0.05)
        );
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
          <button
            type="button"
            class="secondary"
            @click=${this.onCancel}
          >${this.cancelLabel}</button>
          <button
            type="submit"
            class="primary"
            ?disabled=${!canSubmit}
          >${this.submitLabel}</button>
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
        return html`
          <select
            id=${`f-${f.name}`}
            @change=${(e: Event) =>
              this.setField(f.name, (e.target as HTMLSelectElement).value)}
          >
            ${!f.required && !f.defaultValue
              ? html`<option value=""></option>`
              : nothing}
            ${f.enumValues.map(
              (opt) => html`<option
                value=${String(opt)}
                ?selected=${String(v) === String(opt)}
              >${String(opt)}</option>`,
            )}
          </select>
        `;
      case "boolean":
        return html`
          <input
            id=${`f-${f.name}`}
            type="checkbox"
            ?checked=${Boolean(v)}
            @change=${(e: Event) =>
              this.setField(f.name, (e.target as HTMLInputElement).checked)}
          />
        `;
      case "number":
      case "integer":
        return html`
          <input
            id=${`f-${f.name}`}
            type="number"
            step=${f.kind === "integer" ? "1" : "any"}
            .value=${v === undefined || v === null ? "" : String(v)}
            @input=${(e: Event) => {
              const text = (e.target as HTMLInputElement).value;
              if (text === "") {
                this.setField(f.name, undefined);
                return;
              }
              const n = f.kind === "integer" ? parseInt(text, 10) : Number(text);
              this.setField(f.name, Number.isFinite(n) ? n : undefined);
            }}
          />
        `;
      case "array": {
        // Render as a comma-separated text input. OMC parameter arrays are
        // small (e.g. `r_CM[3]`) and the comma form is what most tools use
        // for hand-editing. We split on commas; downstream serialisation
        // is the caller's problem.
        const arr = Array.isArray(v) ? v : [];
        return html`
          <input
            id=${`f-${f.name}`}
            type="text"
            .value=${arr.map((x) => stringifyAtom(x)).join(", ")}
            placeholder=${`comma-separated ${f.itemKind ?? "string"} values`}
            @input=${(e: Event) =>
              this.setField(
                f.name,
                parseArrayInput(
                  (e.target as HTMLInputElement).value,
                  f.itemKind ?? "string",
                ),
              )}
          />
        `;
      }
      case "string":
        return html`
          <input
            id=${`f-${f.name}`}
            type="text"
            .value=${v === undefined || v === null ? "" : String(v)}
            @input=${(e: Event) =>
              this.setField(f.name, (e.target as HTMLInputElement).value)}
          />
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
