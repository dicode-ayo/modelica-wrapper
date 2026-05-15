/**
 * Stories for `<om-action-panel>`.
 *
 * Renders the panel anchored over a fake diagram surface so the floating
 * placement looks right. Click handlers log to console — the real
 * webview wiring routes them to extension messages.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/action-panel/action-panel.component.js";
import type { ActionPanelAnchor } from "../src/action-panel/action-panel.component.js";

interface StoryArgs {
  anchor: ActionPanelAnchor;
  disabled: boolean;
  hideCheck: boolean;
  hideSimulate: boolean;
  hideParameters: boolean;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/ActionPanel",
  argTypes: {
    anchor: {
      control: { type: "select" },
      options: ["top-right", "top-left", "bottom-right", "bottom-left"],
    },
  },
  render: ({
    anchor,
    disabled,
    hideCheck,
    hideSimulate,
    hideParameters,
  }: StoryArgs): TemplateResult => html`
    <div
      style="position: relative; height: 320px; background: repeating-linear-gradient(45deg, #f5f5f5, #f5f5f5 8px, #ececec 8px, #ececec 16px); border-radius: 4px;"
      @om-action-check=${() => console.log("check")}
      @om-action-simulate=${() => console.log("simulate")}
      @om-action-parameters=${() => console.log("parameters")}
    >
      <om-action-panel
        anchor=${anchor}
        ?disabled=${disabled}
        ?hide-check=${hideCheck}
        ?hide-simulate=${hideSimulate}
        ?hide-parameters=${hideParameters}
      ></om-action-panel>
    </div>
  `,
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {
  args: {
    anchor: "top-right",
    disabled: false,
    hideCheck: false,
    hideSimulate: false,
    hideParameters: false,
  },
};

export const BottomLeft: Story = {
  args: {
    anchor: "bottom-left",
    disabled: false,
    hideCheck: false,
    hideSimulate: false,
    hideParameters: false,
  },
};

export const Disabled: Story = {
  args: {
    anchor: "top-right",
    disabled: true,
    hideCheck: false,
    hideSimulate: false,
    hideParameters: false,
  },
};

export const ParametersOnly: Story = {
  args: {
    anchor: "top-right",
    disabled: false,
    hideCheck: true,
    hideSimulate: true,
    hideParameters: false,
  },
};
