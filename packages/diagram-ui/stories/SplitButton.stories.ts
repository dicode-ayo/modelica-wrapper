/**
 * Stories for the standalone `<om-split-button>` — a main action button flush
 * against a chevron that opens a variant menu. Used by the diagram toolbar for
 * rotate / flip / draw, but it's presentational and reusable on its own.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/action-panel/split-button.component.js";
import type { SplitButtonSelectDetail } from "../src/action-panel/split-button.component.js";
import {
  rotateCcwIcon,
  rotateIcon,
} from "../src/action-panel/toolbar-icons.js";

interface StoryArgs {
  active: boolean;
  disabled: boolean;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/SplitButton",
  parameters: { chromatic: { disableSnapshot: true } },
  render: ({ active, disabled }: StoryArgs): TemplateResult => html`
    <div
      style="padding: 16px;"
      @om-split-main=${(e: Event) => {
        const status = (e.currentTarget as HTMLElement).querySelector(
          ".om-split-status",
        );
        if (status) status.textContent = "main";
      }}
      @om-split-select=${(e: CustomEvent<SplitButtonSelectDetail>) => {
        const status = (e.currentTarget as HTMLElement).querySelector(
          ".om-split-status",
        );
        if (status) status.textContent = `select: ${e.detail.value}`;
      }}
    >
      <om-split-button
        .mainIcon=${rotateIcon}
        main-title="Rotate clockwise"
        chevron-title="Rotate direction"
        ?active=${active}
        ?disabled=${disabled}
        .items=${[
          { value: "cw", icon: rotateIcon, label: "Clockwise" },
          { value: "ccw", icon: rotateCcwIcon, label: "Counter-clockwise" },
        ]}
      ></om-split-button>
      <pre class="om-split-status" style="font-size:11px;color:#444;">
(none)</pre>
    </div>
  `,
  argTypes: {
    active: { control: { type: "boolean" } },
    disabled: { control: { type: "boolean" } },
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = { args: { active: false, disabled: false } };
export const Active: Story = { args: { active: true, disabled: false } };
export const Disabled: Story = { args: { active: false, disabled: true } };
