/**
 * Serialize a typed {@link Shape} into a Modelica §18.6 record literal for
 * writing back into an `Icon`/`Diagram` annotation.
 *
 * The inverse of `shapes.ts`'s `decodeShape`. Two asymmetries with the
 * decoder are deliberate:
 *
 *  - Emission uses NAMED arguments (`Rectangle(extent=…, lineColor=…)`) and
 *    drops absent optionals, rather than the decoder's fully-populated
 *    positional layout. Named args keep the written `.mo` readable and let us
 *    omit defaults; OMC normalizes them back to positional records on the next
 *    read, which is where round-trip losslessness is proven.
 *  - Enum fields carry only a bare name on the typed shape (`"Solid"`); the
 *    decoder stripped the qualifier on the way in, so we re-qualify per field
 *    here (`pattern` → `LinePattern.Solid`). The field→type map mirrors the
 *    decoder's read sites.
 */

import type {
  CallExpr,
  ComponentRef,
  EnumLiteral,
  Expression,
  RecordValue,
} from "../../_shared/modelInstance.js";
import type {
  BitmapShape,
  Color,
  EllipseShape,
  Extent,
  GraphicItem,
  LineShape,
  PolygonShape,
  Point,
  RectangleShape,
  Shape,
  TextShape,
} from "../../_shared/diagramLayout.js";

function point(p: Point): string {
  return `{${p[0]}, ${p[1]}}`;
}

function points(ps: Point[]): string {
  return `{${ps.map(point).join(", ")}}`;
}

function color(c: Color): string {
  return `{${c[0]}, ${c[1]}, ${c[2]}}`;
}

function extent(e: Extent): string {
  return `{${point(e[0])}, ${point(e[1])}}`;
}

function enumLit(type: string, bareName: string): string {
  return `${type}.${bareName}`;
}

function str(s: string): string {
  return JSON.stringify(s);
}

/** `visible` / `origin` / `rotation`, emitted only when non-absent. */
function graphicItemArgs(s: GraphicItem): string[] {
  const out: string[] = [];
  if (s.visible !== undefined)
    out.push(`visible=${s.visible ? "true" : "false"}`);
  if (s.origin !== undefined) out.push(`origin=${point(s.origin)}`);
  if (s.rotation !== undefined) out.push(`rotation=${String(s.rotation)}`);
  return out;
}

interface FilledShapeFields {
  lineColor?: Color | undefined;
  fillColor?: Color | undefined;
  pattern?: string | undefined;
  fillPattern?: string | undefined;
  lineThickness?: number | undefined;
}

/** The five FilledShape fields shared by Polygon/Rectangle/Ellipse/Text. */
function filledShapeArgs(s: FilledShapeFields): string[] {
  const out: string[] = [];
  if (s.lineColor) out.push(`lineColor=${color(s.lineColor)}`);
  if (s.fillColor) out.push(`fillColor=${color(s.fillColor)}`);
  if (s.pattern) out.push(`pattern=${enumLit("LinePattern", s.pattern)}`);
  if (s.fillPattern)
    out.push(`fillPattern=${enumLit("FillPattern", s.fillPattern)}`);
  if (s.lineThickness !== undefined) {
    out.push(`lineThickness=${String(s.lineThickness)}`);
  }
  return out;
}

/**
 * Render a Text shape's `textString` Expression to a Modelica literal.
 * Unknown nodes fall back to `""` rather than throwing.
 */
function expressionToModelica(expr: Expression): string {
  if (typeof expr === "string") return str(expr);
  if (typeof expr === "number") return String(expr);
  if (typeof expr === "boolean") return expr ? "true" : "false";
  if (expr === null) return '""';
  if (Array.isArray(expr)) {
    return `{${expr.map(expressionToModelica).join(", ")}}`;
  }
  if (typeof expr === "object" && "$kind" in expr) {
    switch ((expr as { $kind: unknown }).$kind) {
      case "enum":
        return (expr as EnumLiteral).name;
      case "call": {
        const c = expr as CallExpr;
        return `${c.name}(${(c.arguments ?? []).map(expressionToModelica).join(", ")})`;
      }
      case "record": {
        const r = expr as RecordValue;
        return `${r.name}(${r.elements.map(expressionToModelica).join(", ")})`;
      }
      case "cref":
        return (expr as ComponentRef).parts.map((p) => p.name).join(".");
    }
  }
  return '""';
}

function lineArgs(s: LineShape): string[] {
  const out = [...graphicItemArgs(s), `points=${points(s.points)}`];
  if (s.color) out.push(`color=${color(s.color)}`);
  if (s.pattern) out.push(`pattern=${enumLit("LinePattern", s.pattern)}`);
  if (s.thickness !== undefined) out.push(`thickness=${String(s.thickness)}`);
  if (s.arrow) {
    out.push(
      `arrow={${enumLit("Arrow", s.arrow[0])}, ${enumLit("Arrow", s.arrow[1])}}`,
    );
  }
  if (s.arrowSize !== undefined) out.push(`arrowSize=${String(s.arrowSize)}`);
  if (s.smooth) out.push(`smooth=${enumLit("Smooth", s.smooth)}`);
  return out;
}

function polygonArgs(s: PolygonShape): string[] {
  const out = [
    ...graphicItemArgs(s),
    ...filledShapeArgs(s),
    `points=${points(s.points)}`,
  ];
  if (s.smooth) out.push(`smooth=${enumLit("Smooth", s.smooth)}`);
  return out;
}

function rectangleArgs(s: RectangleShape): string[] {
  const out = [...graphicItemArgs(s), ...filledShapeArgs(s)];
  if (s.borderPattern) {
    out.push(`borderPattern=${enumLit("BorderPattern", s.borderPattern)}`);
  }
  out.push(`extent=${extent(s.extent)}`);
  if (s.radius !== undefined) out.push(`radius=${String(s.radius)}`);
  return out;
}

function ellipseArgs(s: EllipseShape): string[] {
  const out = [
    ...graphicItemArgs(s),
    ...filledShapeArgs(s),
    `extent=${extent(s.extent)}`,
  ];
  if (s.startAngle !== undefined)
    out.push(`startAngle=${String(s.startAngle)}`);
  if (s.endAngle !== undefined) out.push(`endAngle=${String(s.endAngle)}`);
  if (s.closure) out.push(`closure=${enumLit("EllipseClosure", s.closure)}`);
  return out;
}

function textArgs(s: TextShape): string[] {
  // TextShape models `textColor` directly and does not carry the FilledShape
  // line/fill fields (the decoder drops them), so no filledShapeArgs here.
  const out = [
    ...graphicItemArgs(s),
    `extent=${extent(s.extent)}`,
    `textString=${expressionToModelica(s.textString)}`,
  ];
  if (s.fontSize !== undefined) out.push(`fontSize=${String(s.fontSize)}`);
  if (s.textColor) out.push(`textColor=${color(s.textColor)}`);
  if (s.fontName !== undefined) out.push(`fontName=${str(s.fontName)}`);
  // An empty `textStyle={}` is rejected by OMC's annotation parser — Modelica
  // can't type an empty array literal as `TextStyle[:]` — so omit it entirely.
  if (s.textStyle && s.textStyle.length > 0) {
    out.push(
      `textStyle={${s.textStyle.map((t) => enumLit("TextStyle", t)).join(", ")}}`,
    );
  }
  if (s.horizontalAlignment) {
    out.push(
      `horizontalAlignment=${enumLit("TextAlignment", s.horizontalAlignment)}`,
    );
  }
  return out;
}

function bitmapArgs(s: BitmapShape): string[] {
  const out = [...graphicItemArgs(s), `extent=${extent(s.extent)}`];
  if (s.fileName !== undefined) out.push(`fileName=${str(s.fileName)}`);
  if (s.imageSource !== undefined)
    out.push(`imageSource=${str(s.imageSource)}`);
  return out;
}

const SHAPE_NAME: Record<Shape["kind"], string> = {
  line: "Line",
  polygon: "Polygon",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  text: "Text",
  bitmap: "Bitmap",
};

/**
 * Serialize a {@link Shape} to a Modelica record literal, e.g.
 * `Rectangle(extent={{-40, -40}, {40, 40}}, lineColor={0, 0, 255})`.
 */
export function shapeToRecord(shape: Shape): string {
  const args = ((): string[] => {
    switch (shape.kind) {
      case "line":
        return lineArgs(shape);
      case "polygon":
        return polygonArgs(shape);
      case "rectangle":
        return rectangleArgs(shape);
      case "ellipse":
        return ellipseArgs(shape);
      case "text":
        return textArgs(shape);
      case "bitmap":
        return bitmapArgs(shape);
    }
  })();
  return `${SHAPE_NAME[shape.kind]}(${args.join(", ")})`;
}
