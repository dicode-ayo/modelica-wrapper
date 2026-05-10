/**
 * Smoke story: proves the Storybook setup boots before any om-* element
 * exists. Replaced/augmented by per-element stories as stages B1+ land.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import { PACKAGE_NAME } from "../src/index.js";

interface StoryArgs {
  title: string;
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/Scaffold",
  render: ({ title }: StoryArgs): TemplateResult => html`
    <div class="om-story">
      <h3>${title}</h3>
      <p>Package: <code>${PACKAGE_NAME}</code></p>
    </div>
  `,
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Hello: Story = {
  args: {
    title: "diagram-ui scaffold smoke story",
  },
};
