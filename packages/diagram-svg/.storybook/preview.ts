import type { Preview } from "@storybook/html";

/**
 * Minimal global preview config:
 *  - Inject a tiny CSS reset so SVG icons render at the size we asked for
 *    instead of inheriting Storybook's default chrome margins.
 *  - Default to a light page background so dark strokes are visible.
 */

const styleId = "diagram-svg-storybook-reset";
if (typeof document !== "undefined" && !document.getElementById(styleId)) {
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    body { margin: 0; padding: 16px; background: #f7f7f8; }
    .diagram-svg-story { display: inline-block; padding: 8px; background: white; border: 1px solid #ddd; border-radius: 4px; margin: 8px; }
    .diagram-svg-story h3 { font-family: sans-serif; font-size: 12px; margin: 0 0 8px 0; color: #444; }
    .diagram-svg-story svg { display: block; }
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
