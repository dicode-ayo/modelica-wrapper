import { createContext } from "@lit/context";
import type { TextSubstitutions } from "@modelica-wrapper/diagram-svg";

/**
 * Lit context propagating `%`-substitution values down the
 * `<om-component>` subtree. `<om-component>` provides its own
 * substitutions (name + class + parameter map built from class defaults
 * + per-instance modifier overrides) for descendants; `<om-text>`
 * consumes the value to resolve `%name`, `%class`, `%<paramName>`
 * tokens in its `TextShape.textString` before rasterising.
 *
 * `null` means "no substitutions in scope" — text shapes render their
 * raw template (e.g. the `%name` text on a host-class icon outside any
 * component subtree stays literal).
 */
export const substitutionsContext = createContext<TextSubstitutions | null>(
  Symbol("om-substitutions"),
);
