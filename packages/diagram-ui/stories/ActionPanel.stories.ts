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
  noSelection: boolean;
  hideCheck: boolean;
  hideSimulate: boolean;
  hideParameters: boolean;
  hideRotate: boolean;
  hideFlip: boolean;
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
    noSelection,
    hideCheck,
    hideSimulate,
    hideParameters,
    hideRotate,
    hideFlip,
  }: StoryArgs): TemplateResult => html`
    <div
      style="position: relative; height: 320px; background: repeating-linear-gradient(45deg, #f5f5f5, #f5f5f5 8px, #ececec 8px, #ececec 16px); border-radius: 4px;"
      @om-action-check=${() => console.log("check")}
      @om-action-simulate=${() => console.log("simulate")}
      @om-action-parameters=${() => console.log("parameters")}
      @om-action-rotate=${() => console.log("rotate")}
      @om-action-flip=${() => console.log("flip")}
    >
      <om-action-panel
        anchor=${anchor}
        ?disabled=${disabled}
        ?no-selection=${noSelection}
        ?hide-check=${hideCheck}
        ?hide-simulate=${hideSimulate}
        ?hide-parameters=${hideParameters}
        ?hide-rotate=${hideRotate}
        ?hide-flip=${hideFlip}
      ></om-action-panel>
    </div>
  `,
};

export default meta;

type Story = StoryObj<StoryArgs>;

const baseArgs: StoryArgs = {
  anchor: "top-right",
  disabled: false,
  noSelection: false,
  hideCheck: false,
  hideSimulate: false,
  hideParameters: false,
  hideRotate: false,
  hideFlip: false,
};

export const Default: Story = {
  args: { ...baseArgs },
};

export const BottomLeft: Story = {
  args: { ...baseArgs, anchor: "bottom-left" },
};

export const Disabled: Story = {
  args: { ...baseArgs, disabled: true },
};

/** Rotate / Flip disable themselves while nothing is selected. */
export const NoSelection: Story = {
  args: { ...baseArgs, noSelection: true },
};

export const ParametersOnly: Story = {
  args: {
    ...baseArgs,
    hideCheck: true,
    hideSimulate: true,
    hideRotate: true,
    hideFlip: true,
  },
};
