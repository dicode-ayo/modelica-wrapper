/**
 * Renderer-backend comparison story: renders the PID_Controller fixture
 * through each of Pixi's three backends so they can be compared on the
 * same scene.
 *
 * `<om-scene>` reads `rendererFactory` once, in `firstUpdated` — a later
 * assignment is ignored, and `unmount()` latches `disposed` so a
 * reconnected instance stays dead. Switching therefore has to discard the
 * element and build a new one, which is what `keyed` does here.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import type { RendererPreference } from "pixi.js";

import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import {
  createRendererFactory,
  type RendererFactory,
} from "../src/scene/scene.component.js";

import { pidLayout } from "./fixtures/pid-layout.js";

const BACKENDS: readonly RendererPreference[] = ["webgl", "webgpu", "canvas"];

let currentLayout: DiagramLayout = pidLayout;

const statusRef: Ref<HTMLElement> = createRef();

function reportBackend(text: string, ok: boolean): void {
  const el = statusRef.value;
  if (el === undefined) return;
  el.textContent = text;
  el.style.color = ok ? "#1a7f37" : "#b42318";
}

/**
 * Wraps the scene's own factory with a single-backend allowlist and a
 * status report. Sharing `createRendererFactory` keeps the comparison on
 * the shipping renderer options rather than a restated copy of them.
 */
const makeRendererFactory =
  (preference: RendererPreference): RendererFactory =>
  async (canvas, size) => {
    try {
      const renderer = await createRendererFactory([preference])(canvas, size);
      // A backend switch tears down the old canvas while its init may still
      // be in flight; letting a discarded factory report would label the
      // status line with a backend that is not the one on screen.
      if (renderer === null || !canvas.isConnected) {
        renderer?.destroy();
        return null;
      }
      reportBackend(`${renderer.name} — initialized`, true);
      return renderer;
    } catch (err) {
      if (!canvas.isConnected) return null;
      reportBackend(`${preference} — unavailable (${String(err)})`, false);
      return null;
    }
  };

interface StoryArgs {
  renderer: RendererPreference;
  perfHud: boolean;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/RendererBackend",
  render: ({ renderer, perfHud }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>&lt;om-graphical-layout&gt; — renderer backend (PID_Controller)</h3>
      <p class="om-story-caption">
        Flip <strong>renderer</strong> in the controls to rebuild the scene on a
        different Pixi backend. Each pick is pinned to one backend (see
        <code>createRendererFactory</code>), so an unsupported one fails visibly
        rather than falling back and mislabelling what is on screen. Drag
        components and pan/zoom to compare feel; the perf HUD shows frame cost.
      </p>
      <p class="om-story-caption">
        The HUD's GPU line comes from a throwaway WebGL probe, not from the
        active renderer — it reports a GPU name even in <code>canvas</code>
        mode. All three backends paint pixels into the same
        <code>&lt;canvas&gt;</code>; none of them produce vector output.
      </p>
      ${keyed(
        renderer,
        html`
          <p class="om-story-caption">
            backend:
            <span ${ref(statusRef)} style="font-weight:600;"
              >initializing…</span
            >
          </p>
          <div class="om-story-canvas-host" style="height: 600px;">
            <om-graphical-layout
              .layout=${currentLayout}
              .rendererFactory=${makeRendererFactory(renderer)}
              ?perf-hud=${perfHud}
              @om-graphical-layout-change=${(e: CustomEvent<DiagramLayout>) => {
                currentLayout = e.detail;
              }}
            ></om-graphical-layout>
          </div>
        `,
      )}
    </div>
  `,
  argTypes: {
    renderer: {
      control: { type: "inline-radio" },
      options: BACKENDS,
    },
    perfHud: { control: { type: "boolean" }, name: "perf-hud" },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Backend: Story = {
  args: {
    renderer: "webgl",
    perfHud: true,
  },
  parameters: { chromatic: { disableSnapshot: true } },
};
