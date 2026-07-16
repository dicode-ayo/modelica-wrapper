import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { DocumentationOpenLinkDetail } from "./events.js";
import {
  hasInterfaceSections,
  type DocConnectorRow,
  type DocExtendsNode,
  type DocParameterRow,
  type DocumentationInterface,
} from "./interface-model.js";

/**
 * Read-only render of a class's auto-generated interface — the "Extends from"
 * tree, the parameter table, and the connector table — shown beneath its
 * `Documentation(info=…)` HTML, as OMEdit's generated docs do.
 *
 * A pure renderer: it takes a `DocumentationInterface` in and emits
 * `om-documentation-open-link` (the same event the WYSIWYG editor uses) when a
 * base class is clicked, so the host resolves and opens it. Each section hides
 * when empty, and the whole element renders nothing when there is no interface.
 */
@customElement("om-documentation-interface")
export class OmDocumentationInterface extends LitElement {
  @property({ attribute: false })
  model: DocumentationInterface | undefined = undefined;

  static override styles = css`
    :host {
      --om-doc-section-gap: 1.5rem;
      --om-doc-heading-gap: 0.5rem;
      --om-doc-heading-size: 1.1em;
      --om-doc-strong-weight: 600;
      --om-doc-cell-pad-block: 0.25rem;
      --om-doc-cell-pad-inline: 0.75rem;
      --om-doc-group-gap: 0.75rem;
      --om-doc-indent: 1.25rem;
      --om-doc-border: 1px solid var(--vscode-editorWidget-border, transparent);
      display: block;
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    section {
      margin-block-start: var(--om-doc-section-gap);
    }
    h2 {
      margin-block-end: var(--om-doc-heading-gap);
      font-size: var(--om-doc-heading-size);
      font-weight: var(--om-doc-strong-weight);
      border-block-end: var(--om-doc-border);
      padding-block-end: var(--om-doc-cell-pad-block);
    }
    table {
      border-collapse: collapse;
      inline-size: 100%;
    }
    th,
    td {
      text-align: start;
      vertical-align: top;
      padding-block: var(--om-doc-cell-pad-block);
      padding-inline: 0 var(--om-doc-cell-pad-inline);
      border-block-end: var(--om-doc-border);
    }
    th {
      color: var(--vscode-descriptionForeground);
      font-weight: var(--om-doc-strong-weight);
    }
    td.group {
      padding-block-start: var(--om-doc-group-gap);
      color: var(--vscode-descriptionForeground);
      font-weight: var(--om-doc-strong-weight);
    }
    code {
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .unit,
    .direction {
      color: var(--vscode-descriptionForeground);
    }
    ul {
      margin: 0;
      padding-inline-start: var(--om-doc-indent);
      list-style: none;
    }
    li::before {
      content: "⌞ ";
      color: var(--vscode-descriptionForeground);
    }
    a {
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .comment {
      color: var(--vscode-descriptionForeground);
    }
  `;

  override render(): typeof nothing | TemplateResult {
    const model = this.model;
    if (!hasInterfaceSections(model)) return nothing;
    // happy-dom (the test environment) drops sibling child-parts at a
    // template root; a single wrapping element keeps every section rendered
    // under it. The row tables flatten their rows into arrays for the same
    // reason (see renderParameters).
    return html`<div class="sections">
      ${this.renderExtends(model.extendsTree)}
      ${this.renderParameters(model.parameters)}
      ${this.renderConnectors(model.connectors)}
    </div>`;
  }

  private renderExtends(
    nodes: DocExtendsNode[],
  ): typeof nothing | TemplateResult {
    if (nodes.length === 0) return nothing;
    return html`
      <section>
        <h2>Extends from</h2>
        ${this.renderExtendsList(nodes)}
      </section>
    `;
  }

  private renderExtendsList(nodes: DocExtendsNode[]): TemplateResult {
    return html`
      <ul>
        ${nodes.map(
          (node) => html`
            <li>
              <a
                href=${`modelica://${node.name}`}
                @click=${(e: Event) => this.onOpenClass(e, node.name)}
                >${node.name}</a
              >${node.comment
                ? html` <span class="comment">(${node.comment})</span>`
                : nothing}
              ${node.children.length > 0
                ? this.renderExtendsList(node.children)
                : nothing}
            </li>
          `,
        )}
      </ul>
    `;
  }

  private renderParameters(
    rows: DocParameterRow[],
  ): typeof nothing | TemplateResult {
    if (rows.length === 0) return nothing;
    // A group heading row is only worth showing once more than one group is
    // present; a single default `Parameters` group reads as noise.
    const groups = [...new Set(rows.map((r) => r.group))];
    const showGroups = groups.length > 1;
    // Flattened into one array (not nested group/row `map`s) so the `<tbody>`
    // holds a single child-part — happy-dom drops sibling child-parts.
    const bodyRows: TemplateResult[] = [];
    for (const group of groups) {
      if (showGroups) {
        bodyRows.push(
          html`<tr>
            <td class="group" colspan="4">${group}</td>
          </tr>`,
        );
      }
      for (const row of rows.filter((r) => r.group === group)) {
        bodyRows.push(
          html`<tr>
            <td><code>${row.name}</code></td>
            <td>${row.value}</td>
            <td class="unit">${row.unit ?? nothing}</td>
            <td>${row.description ?? nothing}</td>
          </tr>`,
        );
      }
    }
    return html`
      <section>
        <h2>Parameters</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Default</th>
              <th>Unit</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </section>
    `;
  }

  private renderConnectors(
    rows: DocConnectorRow[],
  ): typeof nothing | TemplateResult {
    if (rows.length === 0) return nothing;
    return html`
      <section>
        <h2>Connectors</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Name</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (row) => html`
                <tr>
                  <td>
                    <code>${row.typeName}</code>${row.direction
                      ? html` <span class="direction">(${row.direction})</span>`
                      : nothing}
                  </td>
                  <td><code>${row.name}</code></td>
                  <td>${row.description ?? nothing}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </section>
    `;
  }

  private onOpenClass(e: Event, className: string): void {
    e.preventDefault();
    this.dispatchEvent(
      new CustomEvent<DocumentationOpenLinkDetail>(
        "om-documentation-open-link",
        {
          detail: { href: `modelica://${className}` },
          bubbles: true,
          composed: true,
        },
      ),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "om-documentation-interface": OmDocumentationInterface;
  }
}
