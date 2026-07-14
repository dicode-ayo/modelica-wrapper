import type { Extensions } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

/**
 * The Modelica `Documentation(info=…)` tag subset, expressed as a fixed TipTap
 * extension set. It is the single schema shared by the live editor and the
 * headless round-trip (`canonicalizeInner`), so what the user edits and what the
 * golden test checks cannot drift.
 *
 * Being an explicit schema is the point: ProseMirror drops any tag outside it,
 * which is why the raw-HTML Source tab exists as the escape hatch. StarterKit
 * carries the base nodes and marks (paragraphs, headings, lists, blockquote,
 * code, bold/italic/strike/underline); the rest below fills in the Modelica
 * subset it omits (links to `modelica://`, images, sub/superscript, tables). Two
 * configs matter for the round-trip:
 *   - `link: false` on StarterKit disables its bundled Link so ours (below) is
 *     the only one, and `modelica` joins the allowed protocols so a
 *     `modelica://Foo.Bar` href isn't stripped as an unknown scheme. Dangerous
 *     schemes stay blocked by TipTap's own validation. `target`/`rel` are nulled
 *     out so the serialized `<a>` matches the terse form Modelica sources use.
 *   - `Image` is inline so an `<img>` inside a paragraph stays there instead of
 *     splitting the paragraph and leaving an empty one behind.
 */
export const documentationExtensions: Extensions = [
  StarterKit.configure({ link: false }),
  Link.configure({
    openOnClick: false,
    protocols: ["modelica"],
    HTMLAttributes: { target: null, rel: null },
  }),
  Image.configure({ inline: true, HTMLAttributes: {} }),
  Subscript,
  Superscript,
  Table,
  TableRow,
  TableHeader,
  TableCell,
];
