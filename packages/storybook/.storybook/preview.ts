import type { Decorator, Preview } from "@storybook/web-components";

// Boot Web Awesome's theme + the vscode-token bridge once per page so the
// diagram-ui stories can use `<wa-*>` components with native-feeling chrome.
import "@dicode/ui-common/webawesome-setup";

/**
 * Combined preview for the aggregator Storybook — folds together the three
 * per-package previews that used to live in diagram-svg, diagram-ui and
 * result-ui:
 *
 *  - The `--vscode-*` variables result-ui themes off are injected on `:root`
 *    globally; the diagram groups simply don't reference them.
 *  - The card / canvas-host helper classes from all three are merged into one
 *    stylesheet.
 *  - The page background differs per group: the diagram stories want a light
 *    page so dark strokes read; result-ui mirrors the dark VSCode editor. The
 *    `themeByGroup` decorator flips `body` to the dark theme for `result-ui/*`
 *    and clears the override (back to the light default below) for the rest.
 */
const styleId = "combined-storybook-theme";
if (typeof document !== "undefined" && !document.getElementById(styleId)) {
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    :root {
      --vscode-font-family: system-ui, sans-serif;
      --vscode-font-size: 13px;
      --vscode-editor-font-family: ui-monospace, "SF Mono", monospace;
      --vscode-foreground: #cccccc;
      --vscode-descriptionForeground: #9d9d9d;
      --vscode-errorForeground: #f14c4c;
      --vscode-editor-background: #1e1e1e;
      --vscode-editorWidget-background: #252526;
      --vscode-editorInactiveSelectionBackground: #3a3d41;
      --vscode-panel-border: #454545;
      --vscode-list-hoverBackground: #2a2d2e;
      --vscode-input-background: #3c3c3c;
      --vscode-input-foreground: #cccccc;
      --vscode-input-border: #3c3c3c;
      --vscode-button-background: #0e639c;
      --vscode-button-foreground: #ffffff;
      --vscode-button-secondaryBackground: #3a3d41;
      --vscode-badge-background: #4d4d4d;
      --vscode-badge-foreground: #ffffff;
      --vscode-charts-blue: #4e9bff;
      --vscode-charts-red: #f14c4c;
      --vscode-charts-green: #89d185;
      --vscode-charts-yellow: #e2c08d;
      --vscode-charts-purple: #b180d7;
      --vscode-charts-orange: #d18616;
    }

    /* Light page default — diagram-svg + diagram-ui groups. */
    body { margin: 0; padding: 16px; background: #f7f7f8; font-family: sans-serif; }

    /* diagram-svg cards */
    .diagram-svg-story { display: inline-block; padding: 8px; background: white; border: 1px solid #ddd; border-radius: 4px; margin: 8px; }
    .diagram-svg-story h3 { font-family: sans-serif; font-size: 12px; margin: 0 0 8px 0; color: #444; }
    .diagram-svg-story svg { display: block; }

    /* diagram-ui cards + Babylon canvas host */
    .om-story { display: block; padding: 8px; background: white; border: 1px solid #ddd; border-radius: 4px; margin: 8px 0; }
    .om-story h3 { font-size: 12px; margin: 0 0 8px 0; color: #444; }
    .om-story-canvas-host { width: 640px; height: 480px; position: relative; }

    /* result-ui fullscreen host */
    .om-story-host { height: 540px; border: 1px solid var(--vscode-panel-border); }
  `;
  document.head.appendChild(style);
}

/**
 * result-ui renders against the dark VSCode editor; the diagram groups want the
 * light page from the stylesheet above. Set the dark override only for
 * `result-ui/*` and clear it otherwise so the light default wins again when you
 * navigate back to a diagram story.
 */
const themeByGroup: Decorator = (story, context) => {
  if (typeof document !== "undefined") {
    const isResultUi = context.title.startsWith("result-ui/");
    document.body.style.background = isResultUi
      ? "var(--vscode-editor-background)"
      : "";
    document.body.style.color = isResultUi ? "var(--vscode-foreground)" : "";
    document.body.style.padding = isResultUi ? "0" : "";
  }
  return story();
};

const preview: Preview = {
  decorators: [themeByGroup],
  parameters: {
    layout: "fullscreen",
    controls: { expanded: false },
  },
};

export default preview;
