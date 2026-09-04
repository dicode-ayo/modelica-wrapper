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
import { autoDetectRenderer, type RendererPreference } from "pixi.js";

import type { DiagramLayout } from "@dicode/omc-client";

import "../src/graphical-layout/graphical-layout.component.js";
import type { RendererFactory } from "../src/scene/scene.component.js";

import { pidLayout } from "./fixtures/pid-layout.js";
import { appendConnection } from "./fixtures/story-layout-state.js";

/** Matches `SCENE_BACKGROUND` in `scene.component.ts` and the `:host` plate. */
const SCENE_BACKGROUND = 0xf7f7f8;

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
 * Builds a factory pinned to one backend.
 *
 * The array form of `preference` is a strict allowlist. The string form
 * appends every remaining backend as a fallback, so an unsupported pick
 * would quietly resolve to a different renderer than the one selected and
 * the comparison would be measuring the wrong thing.
 */
const makeRendererFactory =
  (preference: RendererPreference): RendererFactory =>
  async (canvas, size) => {
    try {
      const renderer = await autoDetectRenderer({
        preference: [preference],
        canvas,
        width: size.width,
        height: size.height,
        resolution: size.resolution,
        autoDensity: false,
        antialias: true,
        background: SCENE_BACKGROUND,
        clearBeforeRender: true,
      });
      reportBackend(`${renderer.name} — initialized`, true);
      return renderer;
    } catch (err) {
      reportBackend(`${preference} — unavailable (${String(err)})`, false);
      return null;
    }
  };

interface StoryArgs {
  renderer: RendererPreference;
  readonly: boolean;
  lineThicknessScale: number;
  perfHud: boolean;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/RendererBackend",
  render: ({
    renderer,
    readonly,
    lineThicknessScale,
    perfHud,
  }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>&lt;om-graphical-layout&gt; — renderer backend (PID_Controller)</h3>
      <p class="om-story-caption">
        Flip <strong>renderer</strong> in the controls to rebuild the scene on a
        different Pixi backend. Each pick is an exact allowlist, so an
        unsupported one fails visibly rather than falling back. Drag components
        and pan/zoom to compare feel; the perf HUD shows frame cost.
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
              ?readonly=${readonly}
              ?perf-hud=${perfHud}
              .lineThicknessScale=${lineThicknessScale}
              @om-graphical-layout-change=${(e: CustomEvent<DiagramLayout>) => {
                currentLayout = e.detail;
              }}
              @om-connection-create=${(e: CustomEvent) => {
                const detail = e.detail as {
                  fromKey: string;
                  toKey: string;
                  waypoints: ReadonlyArray<readonly [number, number]>;
                };
                currentLayout = appendConnection(currentLayout, detail);
                const el = e.currentTarget as HTMLElement & {
                  layout: DiagramLayout;
                };
                el.layout = currentLayout;
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
    readonly: { control: { type: "boolean" } },
    lineThicknessScale: {
      control: { type: "range", min: 0.5, max: 10, step: 0.25 },
      name: "line-thickness-scale",
    },
    perfHud: { control: { type: "boolean" }, name: "perf-hud" },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Backend: Story = {
  args: {
    renderer: "webgl",
    readonly: false,
    lineThicknessScale: 1,
    perfHud: true,
  },
  parameters: { chromatic: { disableSnapshot: true } },
};
