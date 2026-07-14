/**
 * Stories for `<om-documentation-editor>`, driven by representative Modelica
 * `Documentation(info=…)` HTML (no host, no OMC). The component's bubbling,
 * composed `om-documentation-change` is captured by the actions addon and shown
 * in the Actions panel — the real webview routes the same event to a
 * `setDocumentationAnnotation` write. This is the closest thing to the live
 * editor without VSCode: type, toggle formatting, add a `modelica://` link, and
 * flip to the Source tab to see the canonical HTML the write path emits.
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
    actions: { handles: ["om-documentation-change"] },
  },
};
export default meta;

type Story = StoryObj;

function host(info: string, readOnly = false): TemplateResult {
  return html`
    <div style="height: 32rem; display: flex; border: 1px solid #8884;">
      <om-documentation-editor
        .info=${info}
        ?readOnly=${readOnly}
        style="flex: 1 1 auto;"
      ></om-documentation-editor>
    </div>
  `;
}

/** A rich doc: headings, a cross-reference link, a table, a code block, lists. */
export const RichDoc: Story = { render: () => host(RICH) };

/** A short doc — the common case for most blocks. */
export const SimpleDoc: Story = { render: () => host(SIMPLE) };

/** No documentation yet — an empty canvas ready to type into. */
export const Empty: Story = { render: () => host("<html></html>") };

/** Read-only (an MSL/library class, or one with an infoHeader): no toolbar, not editable. */
export const ReadOnly: Story = { render: () => host(RICH, true) };
