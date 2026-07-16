/**
 * Stories for `<om-error-state>`.
 *
 * Renders the card inside a fixed-height editor-like surface so the
 * fill-and-center layout is visible. The default story mirrors the real
 * payload: a `renderError` for a partially-loaded class.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/error-state/error-state.component.js";

interface StoryArgs {
  heading: string;
  subject: string;
  detail: string;
  hint: string;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/ErrorState",
  render: ({
    heading,
    subject,
    detail,
    hint,
  }: StoryArgs): TemplateResult => html`
    <div style="height: 320px; border: 1px solid #ccc; border-radius: 4px;">
      <om-error-state
        heading=${heading}
        subject=${subject}
        detail=${detail}
        hint=${hint}
      ></om-error-state>
    </div>
  `,
};
export default meta;

type Story = StoryObj<StoryArgs>;

export const RenderFailure: Story = {
  args: {
    heading: "Can't render the diagram",
    subject: "Modelica.Blocks.Examples.PID_Controller",
    detail:
      'Class "Modelica.Blocks.Examples.PID_Controller" is not fully loaded — OMC returned an incomplete model instance. Try loading its enclosing package first.',
    hint: "Make sure the class and its enclosing package load without errors, then reopen this editor.",
  },
};

export const HeadingOnly: Story = {
  args: {
    heading: "Something went wrong",
    subject: "",
    detail: "",
    hint: "",
  },
};
