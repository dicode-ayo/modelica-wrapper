/**
 * Stories for `<om-parameter-panel>` — the floating card wrapper.
 *
 * The host stays interactive (a fake "open" button) so the panel can be
 * toggled and the Escape / close / cancel behaviour is verifiable in
 * Storybook without contriving the open state via a control. The gridded
 * box stands in for the canvas the card floats over.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import type { ParameterModel } from "@dicode/omc-client";
import { html, type TemplateResult } from "lit";

import "../src/parameter-form/parameter-panel.component.js";
import "../src/overlay-stack/overlay-stack.component.js";

interface StoryArgs {
  model: ParameterModel;
  title: string;
}

const G = { tab: "General", group: "Parameters" } as const;

const SIM_MODEL: ParameterModel = {
  className: "Demo.Sim",
  fields: [
    {
      name: "startTime",
      label: "startTime",
      kind: "number",
      value: 0,
      defaultValue: 0,
      dialog: G,
      unitOptions: [],
    },
    {
      name: "stopTime",
      label: "Stop time (s).",
      kind: "number",
      value: 1,
      defaultValue: 1,
      dialog: G,
      unitOptions: [],
    },
    {
      name: "method",
      label: "method",
      kind: "enum",
      value: "dassl",
      defaultValue: "dassl",
      enumChoices: ["dassl", "ida", "euler"],
      dialog: G,
      unitOptions: [],
    },
    {
      name: "emit_protected",
      label: "emit_protected",
      kind: "boolean",
      value: false,
      defaultValue: false,
      dialog: G,
      unitOptions: [],
    },
  ],
};

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/ParameterPanel",
  parameters: { chromatic: { disableSnapshot: true } },
  render: ({ model, title }: StoryArgs): TemplateResult => {
    // Local toggle: the story owns `open`; the panel is fully controlled
    // by it (matching how the real webview hosts it).
    const openPanel = (): void => {
      const el = document.querySelector("#story-panel") as
        (HTMLElement & { open: boolean }) | null;
      if (el) el.open = true;
    };
    const closeReason = (msg: string) => () => {
      console.log(msg);
      const el = document.querySelector("#story-panel") as
        (HTMLElement & { open: boolean }) | null;
      if (el) el.open = false;
    };
    return html`
      <button @click=${openPanel}>Open parameter panel</button>
      <div class="om-story-canvas-host om-story-canvas-stand-in">
        <om-overlay-stack anchor="top-right">
          <om-parameter-panel
            id="story-panel"
            .model=${model}
            .heading=${title}
            @om-panel-cancel=${closeReason("[cancel]")}
            @om-panel-submit=${(e: Event) => {
              const ev = e as CustomEvent<{
                values: Record<string, unknown>;
              }>;
              console.log("[submit]", ev.detail.values);
              closeReason("[submit-close]")();
            }}
          ></om-parameter-panel>
        </om-overlay-stack>
      </div>
    `;
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Simulate: Story = {
  args: {
    model: SIM_MODEL,
    title: "Simulate",
  },
};

/** More fields than the rail is tall, so the card hits its bound and scrolls. */
export const Overflowing: Story = {
  args: {
    model: {
      className: "Demo.Overflowing",
      fields: Array.from({ length: 30 }, (_, i) => ({
        name: `p${i}`,
        label: `p${i}`,
        kind: "number" as const,
        value: i,
        defaultValue: i,
        dialog: G,
        unitOptions: [],
      })),
    },
    title: "Parameters: Overflowing",
  },
};
