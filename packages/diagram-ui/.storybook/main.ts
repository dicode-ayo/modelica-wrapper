import type { StorybookConfig } from "@storybook/web-components-vite";

/**
 * Storybook config for `@dicode/diagram-ui`.
 *
 * Web-components framework because our entities are Lit custom elements
 * (`<om-*>`). Each story imports the element class for its side effect
 * (`customElements.define(...)`) and returns a `lit-html` template that
 * mounts the element with property bindings.
 */
const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|tsx|js|jsx)"],
  framework: {
    name: "@storybook/web-components-vite",
    options: {},
  },
};

export default config;
