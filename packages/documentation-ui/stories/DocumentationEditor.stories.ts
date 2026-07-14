/**
 * Stories for `<om-documentation-editor>`, driven by representative Modelica
 * `Documentation(info=…)` HTML (no host, no OMC). The component's bubbling,
 * composed events are captured by the actions addon and shown in the Actions
 * panel — the real webview routes `om-documentation-change` to a
 * `setDocumentationAnnotation` write, and `om-documentation-edit-source` to
 * opening a native HTML editor. This is the closest thing to the live editor
 * without VSCode: type, toggle formatting, add a `modelica://` link, and watch
 * the pretty-printed `info` the write path emits in the Actions panel.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/index.js";

const RICH = `<html>
<p>This is the text-book version of a <strong>PID-controller</strong>. For a
more practically useful one, see
<a href="modelica://Modelica.Blocks.Continuous.LimPID">LimPID</a>.</p>
<p>Initialization is controlled by <strong>initType</strong>:</p>
<table>
  <tr><th>initType</th><th>Effect</th></tr>
  <tr><td>NoInit</td><td>no initialization</td></tr>
  <tr><td>SteadyState</td><td>der(x) = 0</td></tr>
</table>
<p>The integrator equation is:</p>
<blockquote><pre><code>der(y) = k*u;</code></pre></blockquote>
<ul>
  <li>Set <em>k</em> for the proportional gain.</li>
  <li>Set <em>Ti</em> for the integral time.</li>
</ul>
</html>`;

const SIMPLE = `<html>
<p>This block computes output <em>y</em> as the <em>product</em> of gain
<em>k</em> with the input <em>u</em>:</p>
<blockquote><pre>y = k * u;</pre></blockquote>
</html>`;

const meta: Meta = {
  title: "documentation-ui/DocumentationEditor",
  parameters: {
    actions: {
      handles: ["om-documentation-change", "om-documentation-edit-source"],
    },
  },
};
export default meta;

type Story = StoryObj;

function host(
  info: string,
  opts?: {
    readOnly?: boolean;
    externalSource?: boolean;
    resources?: Record<string, string>;
  },
): TemplateResult {
  return html`
    <div style="height: 32rem; display: flex; border: 1px solid #8884;">
      <om-documentation-editor
        .info=${info}
        .resources=${opts?.resources ?? {}}
        ?readOnly=${opts?.readOnly ?? false}
        ?external-source=${opts?.externalSource ?? false}
        style="flex: 1 1 auto;"
      ></om-documentation-editor>
    </div>
  `;
}

const IMAGE_URI = "modelica://Modelica/Resources/Images/Sample.svg";
const IMAGE_DOC = `<html>
<p>The output signal:</p>
<p><img src="${IMAGE_URI}" alt="signal"></p>
</html>`;
// What the host's resolver would send back for IMAGE_URI (a data: URI).
const IMAGE_DATA =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60">' +
      '<rect width="160" height="60" fill="#3a6ea5"/>' +
      '<text x="80" y="38" fill="#fff" font-size="20" text-anchor="middle" font-family="sans-serif">signal</text>' +
      "</svg>",
  );

/**
 * A rich doc (headings, a cross-reference link, a table, a code block, lists).
 * The web default: "Edit HTML" toggles an inline `<pre>` of the pretty-printed
 * HTML, editable as the raw-source escape hatch.
 */
export const RichDoc: Story = { render: () => host(RICH) };

/** A short doc — the common case for most blocks. */
export const SimpleDoc: Story = { render: () => host(SIMPLE) };

/** No documentation yet — an empty canvas ready to type into. */
export const Empty: Story = { render: () => host("<html></html>") };

/**
 * With a host that provides its own raw-HTML editor (VSCode's native HTML
 * editor): "Edit HTML ↗" emits `om-documentation-edit-source` instead of the
 * inline `<pre>`. Watch the Actions panel.
 */
export const ExternalSource: Story = {
  render: () => host(RICH, { externalSource: true }),
};

/**
 * A `modelica://` resource image. The stored `src` stays `modelica://`; the host
 * resolves it to a `data:` URI (the `resources` map) which the image node view
 * renders. Without the map the `<img>` would be broken.
 */
export const ImageResolved: Story = {
  render: () => host(IMAGE_DOC, { resources: { [IMAGE_URI]: IMAGE_DATA } }),
};

/** Read-only (an MSL/library class, or one with an infoHeader): no toolbar, not editable. */
export const ReadOnly: Story = { render: () => host(RICH, { readOnly: true }) };
