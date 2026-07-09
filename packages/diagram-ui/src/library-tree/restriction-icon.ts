/**
 * Restriction-letter badge shown in front of a row until (or unless) the
 * data source's rendered class SVG arrives. Colours resolve to the
 * `--om-restriction-*` tokens (defined in `omTokens`), so a consumer must
 * apply `omTokens` to the badge's shadow root.
 */

import type { LibraryClassRestriction } from "./library-types.js";

export interface IconStyle {
  /** Single-character glyph rendered in the badge. */
  glyph: string;
  /** Foreground colour of the glyph (a `--om-restriction-fg-*` var). */
  fg: string;
  /** Background colour of the badge (a `--om-restriction-*-bg` var). */
  bg: string;
}

const FG_DARK = "var(--om-restriction-fg-on-dark)";
const FG_LIGHT = "var(--om-restriction-fg-on-light)";

export function iconStyleFor(r: LibraryClassRestriction): IconStyle {
  switch (r) {
    case "package":
      return {
        glyph: "P",
        fg: FG_DARK,
        bg: "var(--om-restriction-package-bg)",
      };
    case "model":
      return { glyph: "M", fg: FG_DARK, bg: "var(--om-restriction-model-bg)" };
    case "block":
      return { glyph: "B", fg: FG_DARK, bg: "var(--om-restriction-block-bg)" };
    case "class":
      return { glyph: "C", fg: FG_DARK, bg: "var(--om-restriction-class-bg)" };
    case "connector":
    case "expandable connector":
      return {
        glyph: "K",
        fg: FG_DARK,
        bg: "var(--om-restriction-connector-bg)",
      };
    case "record":
      return {
        glyph: "R",
        fg: FG_LIGHT,
        bg: "var(--om-restriction-record-bg)",
      };
    case "function":
    case "operator function":
      return {
        glyph: "ƒ",
        fg: FG_DARK,
        bg: "var(--om-restriction-function-bg)",
      };
    case "type":
      return { glyph: "T", fg: FG_LIGHT, bg: "var(--om-restriction-type-bg)" };
    case "operator":
    case "operator record":
      return {
        glyph: "O",
        fg: FG_DARK,
        bg: "var(--om-restriction-operator-bg)",
      };
    case "unknown":
    default:
      return {
        glyph: "?",
        fg: FG_DARK,
        bg: "var(--om-restriction-unknown-bg)",
      };
  }
}
