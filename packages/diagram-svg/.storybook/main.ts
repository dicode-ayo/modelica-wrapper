import type { StorybookConfig } from "@storybook/html-vite";

/**
 * Storybook config for `@modelica-wrapper/diagram-svg`.
 *
 * We use the `@storybook/html-vite` framework because the renderer emits
 * raw SVG strings — no React / Vue runtime needed. Stories are plain
 * functions that return either an HTMLElement or an HTML string and the
 * framework drops them into the preview iframe.
 */
const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|tsx|js|jsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: {
    name: "@storybook/html-vite",
    options: {},
  },
  docs: {
    autodocs: false,
  },
};

export default config;
