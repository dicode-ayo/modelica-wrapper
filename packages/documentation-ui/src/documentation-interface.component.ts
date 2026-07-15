import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { DocumentationOpenLinkDetail } from "./events.js";
import type {
  DocConnectorRow,
  DocExtendsNode,
  DocParameterRow,
  DocumentationInterface,
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
      display: block;
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    section {
      margin-block-start: 1.5rem;
    }
    h2 {
      margin-block-end: 0.5rem;
      font-size: 1.1em;
      font-weight: 600;
      border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
      padding-block-end: 0.25rem;
    }
    table {
      border-collapse: collapse;
      inline-size: 100%;
    }
    th,
    td {
      text-align: start;
      vertical-align: top;
      padding: 0.25rem 0.75rem 0.25rem 0;
      border-bottom: 1px solid var(--vscode-editorWidget-border, transparent);
    }
    th {
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
    }
    td.group {
      padding-block-start: 0.75rem;
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
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
      padding-inline-start: 1.25rem;
      list-style: none;
    }
    ul ul {
      padding-inline-start: 1.25rem;
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
    if (model === undefined) return nothing;
    const { extendsTree, parameters, connectors } = model;
    if (
      extendsTree.length === 0 &&
      parameters.length === 0 &&
      connectors.length === 0
    ) {
      return nothing;
    }
    return html`<div class="sections">
      ${this.renderExtends(extendsTree)} ${this.renderParameters(parameters)}
      ${this.renderConnectors(connectors)}
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
            <td>${row.value || nothing}</td>
            <td class="unit">${row.unit ?? nothing}</td>
            <td>${row.label === row.name ? nothing : row.label}</td>
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
                  <td>${row.label === row.name ? nothing : row.label}</td>
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
