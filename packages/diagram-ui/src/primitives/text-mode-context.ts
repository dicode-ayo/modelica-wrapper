import { createContext } from "@lit/context";

import type { TextMode } from "./text-mode.js";

/**
 * Pixi text class every `<om-text>` under the providing scene builds with,
 * so two scenes on one page can differ. `undefined` falls back to
 * {@link DEFAULT_TEXT_MODE}.
 */
export const textModeContext = createContext<TextMode | undefined>(
  Symbol("om-text-mode"),
);
