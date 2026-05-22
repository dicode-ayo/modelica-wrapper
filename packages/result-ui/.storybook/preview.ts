import type { Preview } from "@storybook/web-components";

/**
 * The components theme entirely off `--vscode-*` variables (with fallbacks). In
 * the real webview VSCode supplies those; here we inject a dark-theme-ish set on
 * `:root` so stories render the way they will in the editor, plus the `--om-*`
 * tokens come from each component's own `omTokens` styles.
 */
const styleId = "result-ui-storybook-theme";
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
    body { margin: 0; background: var(--vscode-editor-background); color: var(--vscode-foreground); }
    .om-story-host { height: 540px; border: 1px solid var(--vscode-panel-border); }
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
