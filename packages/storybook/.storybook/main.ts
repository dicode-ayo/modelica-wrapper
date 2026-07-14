import type { StorybookConfig } from "@storybook/web-components-vite";

/**
 * Aggregator Storybook for the whole monorepo.
 *
 * One Storybook, one Chromatic project: this globs the stories from every
 * visual package so a single build snapshots them together. Story titles are
 * already namespaced per package (`diagram-svg/…`, `diagram-ui/…`,
 * `result-ui/…`, `documentation-ui/…`), so they fall into clean top-level
 * sidebar groups.
 *
 * Framework is `web-components-vite` because diagram-ui and result-ui are Lit
 * custom elements (`<om-*>`). The diagram-svg stories return plain DOM nodes,
 * which the lit-html renderer mounts just as happily, so they ride along
 * unchanged.
 */
const config: StorybookConfig = {
  stories: [
    "../../diagram-svg/stories/**/*.stories.@(ts|tsx|js|jsx)",
    "../../diagram-ui/stories/**/*.stories.@(ts|tsx|js|jsx)",
    "../../result-ui/stories/**/*.stories.@(ts|tsx|js|jsx)",
    "../../documentation-ui/stories/**/*.stories.@(ts|tsx|js|jsx)",
  ],
  addons: ["@storybook/addon-essentials"],
  framework: {
    name: "@storybook/web-components-vite",
    options: {},
  },
  docs: {
    autodocs: false,
  },
};

export default config;
