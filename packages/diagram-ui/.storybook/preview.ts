import type { Preview } from "@storybook/web-components";

/**
 * Minimal global preview config:
 *  - Inject a CSS reset so the Babylon canvas fills its story container
 *    instead of inheriting Storybook's default chrome margins.
 *  - Default to a light page background.
 */

const styleId = "diagram-ui-storybook-reset";
if (typeof document !== "undefined" && !document.getElementById(styleId)) {
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    body { margin: 0; padding: 16px; background: #f7f7f8; font-family: sans-serif; }
    .om-story { display: block; padding: 8px; background: white; border: 1px solid #ddd; border-radius: 4px; margin: 8px 0; }
    .om-story h3 { font-size: 12px; margin: 0 0 8px 0; color: #444; }
    .om-story-canvas-host { width: 640px; height: 480px; position: relative; }
  `;
  document.head.appendChild(style);
}

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    controls: { expanded: false },
  },
};

export default preview;
