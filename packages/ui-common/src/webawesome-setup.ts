/**
 * One-stop setup for using `<wa-*>` components inside the `<om-*>` webviews.
 *
 * Importing this module at app startup (Storybook preview, an extension webview
 * entry) registers Web Awesome's default theme + native form styles, then layers
 * our VSCode bridge on top so wa components inherit the right colours and
 * typography automatically:
 *
 *   import "@modelica-wrapper/ui-common/webawesome-setup";
 *
 * Component-level wa imports (e.g. `<wa-dialog>`) live next to each `<om-*>`
 * component that uses them — this file is only the global theme bootstrap.
 *
 * The bare `import "...css"` lines work via the bundler (Vite for Storybook,
 * esbuild for the extension webviews). They are side-effect-only.
 */

import "@awesome.me/webawesome/dist/styles/themes/default.css";
import "@awesome.me/webawesome/dist/styles/native.css";
import "./wa-bridge.css";
