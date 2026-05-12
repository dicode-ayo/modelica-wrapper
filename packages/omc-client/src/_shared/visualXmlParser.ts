/**
 * Parse OMC's `<Model>_visual.xml` (the `-d=visxml` translateModel artifact)
 * into a `VisualXmlDocument` whose slots are still `XmlExpr` ASTs.
 *
 * Schema (OMC `VisualXMLTpl.tpl`):
 *
 *   <visualization>
 *     <shape>
 *       <ident>bodyShape1.shape_1</ident>
 *       <type>box</type>
 *       <T><exp>…</exp> × 9 </T>
 *       <r><exp>…</exp> × 3 </r>
 *       <r_shape>…</r_shape>
 *       <lengthDir>…</lengthDir>
 *       <widthDir>…</widthDir>
 *       <length><exp>…</exp></length>
 *       <width> ... height ... extra ... color (×3) ... specCoeff
 *     </shape>
 *     <vector>…</vector>
 *     <surface>…</surface>
 *   </visualization>
 *
 * Each `<exp>` is either a numeric literal text node, a single `<cref>` text
 * node, or one of the small AST nodes the resolver understands (binary /
 * unary / call). Parser stays small on purpose — anything beyond literal +
 * cref + the documented AST shapes throws (the resolver downstream can't
 * cope, so failing here gives a clearer error site).
 *
 * `fast-xml-parser` config notes:
 *  - `parseAttributeValue: false` (no attributes in the visxml template, but
 *    paranoid)
 *  - `trimValues: true` so `<exp>  0.5 </exp>` is the same as `<exp>0.5</exp>`
 *  - we keep `parseTagValue: false` and do our own number parsing, so a
 *    literal cref `"body.r[1]"` doesn't get coerced to `NaN`
 */

import { XMLParser } from "fast-xml-parser";

import type {
  VisualXmlDocument,
  XmlExpr,
  XmlMat3,
  XmlShape,
  XmlSurface,
  XmlVec3,
  XmlVector,
} from "./visualScene.js";

const XML_PARSER = new XMLParser({
  ignoreAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

// ---------- low-level helpers ----------

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function expectString(v: unknown, ctx: string): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new Error(`${ctx}: expected a text node, got ${typeof v}`);
}

function isNumericText(s: string): boolean {
  // accept ints, decimals, exponents, leading +/-; reject empty
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s);
}

// ---------- expression decoding ----------

/**
 * Decode an `<exp>` payload. The XML parser hands us either:
 *  - a string (literal text content like `"0.5"` or `"body.r[1]"`),
 *  - a number/boolean (would be unusual with `parseTagValue: false`),
 *  - or an object whose keys are the tag children (`{ cref: "…" }`,
 *    `{ binary: { op: "+", lhs: …, rhs: … } }`, …).
 *
 * The ambiguity between "literal number string" and "cref string" is
 * resolved by `isNumericText`. Any non-numeric string is treated as a cref
 * — OMC emits crefs as bare text inside `<exp>`, e.g.
 * `<exp>revolute1.phi</exp>`.
 */
function decodeExpression(v: unknown, ctx: string): XmlExpr {
  if (typeof v === "string") {
    return isNumericText(v)
      ? { kind: "lit", value: Number(v) }
      : { kind: "cref", name: v };
  }
  if (typeof v === "number") {
    return { kind: "lit", value: v };
  }
  if (v === null || v === undefined) {
    throw new Error(`${ctx}: empty <exp> element`);
  }
  if (typeof v !== "object") {
    throw new Error(`${ctx}: unsupported <exp> payload ${typeof v}`);
  }

  const obj = v as Record<string, unknown>;
  // tag-name dispatch — whichever child tag is present wins
  if ("cref" in obj) {
    return { kind: "cref", name: expectString(obj["cref"], `${ctx}.cref`) };
  }
  if ("binary" in obj) {
    const b = obj["binary"];
    if (typeof b !== "object" || b === null) {
      throw new Error(`${ctx}.binary: expected an object`);
    }
    const node = b as Record<string, unknown>;
    const op = expectString(node["op"], `${ctx}.binary.op`);
    if (op !== "+" && op !== "-" && op !== "*" && op !== "/") {
      throw new Error(`${ctx}.binary.op: unsupported op '${op}'`);
    }
    return {
      kind: "binary",
      op,
      lhs: decodeExpression(node["lhs"], `${ctx}.binary.lhs`),
      rhs: decodeExpression(node["rhs"], `${ctx}.binary.rhs`),
    };
  }
  if ("unary" in obj) {
    const u = obj["unary"];
    if (typeof u !== "object" || u === null) {
      throw new Error(`${ctx}.unary: expected an object`);
    }
    const node = u as Record<string, unknown>;
    const op = expectString(node["op"], `${ctx}.unary.op`);
    if (op !== "-") {
      throw new Error(`${ctx}.unary.op: unsupported op '${op}'`);
    }
    return {
      kind: "unary",
      op,
      exp: decodeExpression(node["exp"], `${ctx}.unary.exp`),
    };
  }
  if ("call" in obj) {
    const c = obj["call"];
    if (typeof c !== "object" || c === null) {
      throw new Error(`${ctx}.call: expected an object`);
    }
    const node = c as Record<string, unknown>;
    const fn = expectString(node["fn"], `${ctx}.call.fn`);
    if (fn !== "cos" && fn !== "sin" && fn !== "sqrt") {
      throw new Error(`${ctx}.call.fn: unsupported fn '${fn}'`);
    }
    const argList = asArray(node["arg"] as unknown);
    const args = argList.map((a, i) =>
      decodeExpression(a, `${ctx}.call.arg[${i}]`),
    );
    return { kind: "call", fn, args };
  }
  // Bare nested `<exp>` (some templates wrap a single child <exp>) — descend.
  if ("exp" in obj) {
    return decodeExpression(obj["exp"], `${ctx}.exp`);
  }
  throw new Error(
    `${ctx}: unrecognized <exp> payload, keys=${Object.keys(obj).join(",")}`,
  );
}

/**
 * `<r>` (or `<rShape>`, `<lengthDir>`, …) wraps exactly three `<exp>` slots.
 * fast-xml-parser folds repeated `<exp>` into an array; a single `<exp>`
 * stays scalar. `asArray` papers over the difference.
 */
function decodeVec3(node: unknown, ctx: string): XmlVec3 {
  if (typeof node !== "object" || node === null) {
    throw new Error(`${ctx}: expected an object with <exp> children`);
  }
  const exps = asArray((node as Record<string, unknown>)["exp"]);
  if (exps.length !== 3) {
    throw new Error(`${ctx}: expected 3 <exp> children, got ${exps.length}`);
  }
  return [
    decodeExpression(exps[0], `${ctx}.exp[0]`),
    decodeExpression(exps[1], `${ctx}.exp[1]`),
    decodeExpression(exps[2], `${ctx}.exp[2]`),
  ];
}

/**
 * `<T>` wraps nine `<exp>` slots in row-major order; we surface it as a
 * 3-tuple of Vec3 (rows). Babylon-side, ingest transposes — see the
 * design doc's "T matrix order" note.
 */
function decodeMat3(node: unknown, ctx: string): XmlMat3 {
  if (typeof node !== "object" || node === null) {
    throw new Error(`${ctx}: expected an object with <exp> children`);
  }
  const exps = asArray((node as Record<string, unknown>)["exp"]);
  if (exps.length !== 9) {
    throw new Error(`${ctx}: expected 9 <exp> children, got ${exps.length}`);
  }
  const decoded = exps.map((e, i) =>
    decodeExpression(e, `${ctx}.exp[${i}]`),
  );
  return [
    [decoded[0]!, decoded[1]!, decoded[2]!],
    [decoded[3]!, decoded[4]!, decoded[5]!],
    [decoded[6]!, decoded[7]!, decoded[8]!],
  ];
}

function decodeColor(
  node: unknown,
  ctx: string,
): [XmlExpr, XmlExpr, XmlExpr] {
  const [r, g, b] = decodeVec3(node, ctx);
  return [r, g, b];
}

/** A single `<… ><exp>…</exp></…>` wrapper. */
function decodeScalar(node: unknown, ctx: string): XmlExpr {
  if (typeof node !== "object" || node === null) {
    // Some templates omit the `<exp>` wrapper for scalars — accept raw text.
    return decodeExpression(node, ctx);
  }
  const obj = node as Record<string, unknown>;
  if ("exp" in obj) {
    return decodeExpression(obj["exp"], `${ctx}.exp`);
  }
  return decodeExpression(node, ctx);
}

// ---------- shape / vector / surface decoders ----------

function decodeShape(node: Record<string, unknown>): XmlShape {
  const ident = expectString(node["ident"], "shape.ident");
  const shapeType = expectString(node["type"], `shape[${ident}].type`);
  const ctx = `shape[${ident}]`;
  return {
    kind: "shape",
    ident,
    shapeType,
    r: decodeVec3(node["r"], `${ctx}.r`),
    T: decodeMat3(node["T"], `${ctx}.T`),
    rShape: decodeVec3(node["r_shape"], `${ctx}.r_shape`),
    lengthDirection: decodeVec3(node["lengthDir"], `${ctx}.lengthDir`),
    widthDirection: decodeVec3(node["widthDir"], `${ctx}.widthDir`),
    length: decodeScalar(node["length"], `${ctx}.length`),
    width: decodeScalar(node["width"], `${ctx}.width`),
    height: decodeScalar(node["height"], `${ctx}.height`),
    extra: decodeScalar(node["extra"], `${ctx}.extra`),
    color: decodeColor(node["color"], `${ctx}.color`),
    specularCoefficient: decodeScalar(
      node["specCoeff"],
      `${ctx}.specCoeff`,
    ),
  };
}

function decodeVector(node: Record<string, unknown>): XmlVector {
  const ident = expectString(node["ident"], "vector.ident");
  const ctx = `vector[${ident}]`;
  return {
    kind: "vector",
    ident,
    r: decodeVec3(node["r"], `${ctx}.r`),
    T: decodeMat3(node["T"], `${ctx}.T`),
    coordinates: decodeVec3(node["coordinates"], `${ctx}.coordinates`),
    color: decodeColor(node["color"], `${ctx}.color`),
    specularCoefficient: decodeScalar(node["specCoeff"], `${ctx}.specCoeff`),
    quantity: expectString(node["quantity"], `${ctx}.quantity`),
    headAtOrigin: decodeScalar(node["headAtOrigin"], `${ctx}.headAtOrigin`),
    twoHeadedArrow: decodeScalar(
      node["twoHeadedArrow"],
      `${ctx}.twoHeadedArrow`,
    ),
  };
}

function decodeSurface(node: Record<string, unknown>): XmlSurface {
  const ident = expectString(node["ident"], "surface.ident");
  const ctx = `surface[${ident}]`;
  return {
    kind: "surface",
    ident,
    r: decodeVec3(node["r"], `${ctx}.r`),
    T: decodeMat3(node["T"], `${ctx}.T`),
    nu: decodeScalar(node["nu"], `${ctx}.nu`),
    nv: decodeScalar(node["nv"], `${ctx}.nv`),
    color: decodeColor(node["color"], `${ctx}.color`),
    specularCoefficient: decodeScalar(node["specCoeff"], `${ctx}.specCoeff`),
    transparency: decodeScalar(node["transparency"], `${ctx}.transparency`),
    wireframe: decodeScalar(node["wireframe"], `${ctx}.wireframe`),
    multiColored: decodeScalar(node["multiColored"], `${ctx}.multiColored`),
  };
}

// ---------- entry point ----------

/**
 * Parse a `<visualization>…</visualization>` XML document. Returns a
 * record-faithful tree; expression slots stay as `XmlExpr` AST nodes for
 * the resolver to substitute later.
 *
 * Empty `<visualization/>` documents (no shapes/vectors/surfaces) yield
 * a document with three empty arrays, not a parse error. OMC emits an
 * empty root for classes with no MultiBody content.
 */
export function parseVisualXml(xml: string): VisualXmlDocument {
  const parsed = XML_PARSER.parse(xml) as Record<string, unknown>;
  if (!("visualization" in parsed)) {
    throw new Error(
      "parseVisualXml: missing <visualization> root element",
    );
  }
  const root = parsed["visualization"];
  // Empty `<visualization></visualization>` or self-closing `<visualization/>`
  // parses to "" — treat the same as "no children".
  if (root === "" || root === null || root === undefined) {
    return { shapes: [], vectors: [], surfaces: [] };
  }
  if (typeof root !== "object") {
    throw new Error(
      "parseVisualXml: <visualization> root must be an element, not a value",
    );
  }
  const r = root as Record<string, unknown>;

  const shapes = asArray(r["shape"]).map((s) => {
    if (typeof s !== "object" || s === null) {
      throw new Error("parseVisualXml: <shape> child is not an object");
    }
    return decodeShape(s as Record<string, unknown>);
  });
  const vectors = asArray(r["vector"]).map((s) => {
    if (typeof s !== "object" || s === null) {
      throw new Error("parseVisualXml: <vector> child is not an object");
    }
    return decodeVector(s as Record<string, unknown>);
  });
  const surfaces = asArray(r["surface"]).map((s) => {
    if (typeof s !== "object" || s === null) {
      throw new Error("parseVisualXml: <surface> child is not an object");
    }
    return decodeSurface(s as Record<string, unknown>);
  });

  return { shapes, vectors, surfaces };
}
