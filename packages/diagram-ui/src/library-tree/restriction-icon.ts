/**
 * Restriction-letter badge shown in front of a row until (or unless) the
 * data source's rendered class SVG arrives. Colours follow loose VSCode
 * symbol-kind conventions: blue=package, purple=class/model, green=block,
 * orange=connector, red=function, yellow=record/type.
 */

import type { LibraryClassRestriction } from "../library-browser/library-browser.component.js";

export interface IconStyle {
  /** Single-character glyph rendered in the badge. */
  glyph: string;
  /** Foreground colour of the glyph. */
  fg: string;
  /** Background colour of the badge. */
  bg: string;
}

export function iconStyleFor(r: LibraryClassRestriction): IconStyle {
  switch (r) {
    case "package":
      return { glyph: "P", fg: "#fff", bg: "#3b82f6" };
    case "model":
      return { glyph: "M", fg: "#fff", bg: "#7c3aed" };
    case "block":
      return { glyph: "B", fg: "#fff", bg: "#10b981" };
    case "class":
      return { glyph: "C", fg: "#fff", bg: "#64748b" };
    case "connector":
    case "expandable connector":
      return { glyph: "K", fg: "#fff", bg: "#f59e0b" };
    case "record":
      return { glyph: "R", fg: "#1f1f1f", bg: "#fde68a" };
    case "function":
    case "operator function":
      return { glyph: "ƒ", fg: "#fff", bg: "#ef4444" };
    case "type":
      return { glyph: "T", fg: "#1f1f1f", bg: "#bae6fd" };
    case "operator":
    case "operator record":
      return { glyph: "O", fg: "#fff", bg: "#0ea5e9" };
    case "unknown":
    default:
      return { glyph: "?", fg: "#fff", bg: "#9ca3af" };
  }
}
