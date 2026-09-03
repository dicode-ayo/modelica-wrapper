import type { StorybookConfig } from "@storybook/web-components-vite";

/**
 * Storybook config for `@dicode/result-ui`.
 *
 * Web-components framework because the postprocessing UI is Lit custom elements
 * (`<om-*>`). Stories import the element for its side effect
 * (`customElements.define`) and mount it with property bindings + mock data.
 */
const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|tsx|js|jsx)"],
  framework: {
    name: "@storybook/web-components-vite",
    options: {},
  },
};

export default config;
