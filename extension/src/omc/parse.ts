/**
 * Parser for OMC's Modelica-syntax RPC responses.
 *
 * OMC returns Modelica-syntax expressions, not JSON. The shapes we encounter:
 *
 *     "foo"                           StringV
 *     true / false                    BoolV
 *     42 / 1.5 / 1e-6                 IntV / FloatV
 *     {a, b, c}                       ListV (brace list)
 *     ("x", 1, true)                  ListV (paren tuple — same TS type)
 *     Modelica.Blocks.Math.Sin        IdentV
 *     Polygon(true, {0,0}, ...)       CallV (used inside icon annotations)
 *     -      (between commas)         NullV
 *
 * Brace lists and paren tuples are both represented as `list`; consumers
 * disambiguate by knowing what shape each OMC call returns.
 */

export type Value =
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "int"; value: number }
  | { kind: "float"; value: number }
  | { kind: "ident"; name: string }
  | { kind: "list"; items: Value[] }
  | { kind: "call"; name: string; args: Value[] }
  | { kind: "null" };

const NULL: Value = { kind: "null" };

/**
 * Parse an OMC response string into a Value.
 *
 * Trailing newlines and surrounding whitespace are tolerated.
 * Empty/whitespace input yields a null Value.
 */
export function parse(src: string): Value {
  const text = src.trim();
  if (text === "") return NULL;
  const p = new Parser(text);
  const v = p.value();
  p.skipSpace();
  if (p.pos !== p.src.length) {
    throw new Error(`unexpected trailing input at ${p.pos}: ${JSON.stringify(p.peek(20))}`);
  }
  return v;
}

class Parser {
  pos = 0;
  constructor(public readonly src: string) {}

  peek(n: number): string {
    return this.src.slice(this.pos, this.pos + n);
  }

  skipSpace(): void {
    while (this.pos < this.src.length) {
      const c = this.src.charCodeAt(this.pos);
      // \t \n \v \f \r space
      if (c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32) {
        this.pos++;
      } else {
        break;
      }
    }
  }

  value(): Value {
    this.skipSpace();
    if (this.pos >= this.src.length) {
      throw new Error("unexpected end of input");
    }
    const c = this.src[this.pos]!;

    if (c === '"') return this.parseString();
    if (c === "{") return this.parseSeq("{", "}");
    if (c === "(") return this.parseSeq("(", ")");

    if (c === "-" || c === "+" || (c >= "0" && c <= "9")) {
      if (c === "-" && this.isNullDash()) {
        this.pos++;
        return NULL;
      }
      return this.parseNumber();
    }

    if (isIdentStart(c)) return this.parseIdentOrCall();

    throw new Error(`unexpected char ${JSON.stringify(c)} at pos ${this.pos}`);
  }

  /** Returns true if `-` at pos is the null sentinel (followed by `,` `}` `)`). */
  private isNullDash(): boolean {
    let i = this.pos + 1;
    while (i < this.src.length) {
      const ch = this.src[i]!;
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        i++;
      } else break;
    }
    if (i >= this.src.length) return true;
    const next = this.src[i]!;
    return next === "," || next === "}" || next === ")";
  }

  private parseString(): Value {
    if (this.src[this.pos] !== '"') {
      throw new Error(`expected '"' at ${this.pos}`);
    }
    this.pos++;
    let out = "";
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === '"') {
        this.pos++;
        return { kind: "string", value: out };
      }
      if (c === "\\" && this.pos + 1 < this.src.length) {
        const next = this.src[this.pos + 1]!;
        switch (next) {
          case '"':
          case "\\":
          case "'":
            out += next;
            break;
          case "n":
            out += "\n";
            break;
          case "t":
            out += "\t";
            break;
          case "r":
            out += "\r";
            break;
          case "a":
            out += "\x07";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "v":
            out += "\v";
            break;
          case "0":
            out += "\0";
            break;
          default:
            out += "\\" + next;
        }
        this.pos += 2;
        continue;
      }
      out += c;
      this.pos++;
    }
    throw new Error(`unterminated string starting at ${this.pos}`);
  }

  private parseSeq(open: string, close: string): Value {
    if (this.src[this.pos] !== open) {
      throw new Error(`expected ${open} at ${this.pos}`);
    }
    this.pos++;
    const items: Value[] = [];
    while (true) {
      this.skipSpace();
      if (this.pos >= this.src.length) {
        throw new Error(`unterminated ${open}...${close}`);
      }
      if (this.src[this.pos] === close) {
        this.pos++;
        return { kind: "list", items };
      }
      // Empty position between commas → null entry.
      if (this.src[this.pos] === ",") {
        items.push(NULL);
        this.pos++;
        continue;
      }
      items.push(this.value());
      this.skipSpace();
      if (this.pos < this.src.length && this.src[this.pos] === ",") {
        this.pos++;
        continue;
      }
      // Else expect close on next iteration.
    }
  }

  private parseNumber(): Value {
    const start = this.pos;
    if (this.src[this.pos] === "+" || this.src[this.pos] === "-") this.pos++;
    let hasDigit = false;
    while (this.pos < this.src.length && isDigit(this.src[this.pos]!)) {
      this.pos++;
      hasDigit = true;
    }
    let isFloat = false;
    if (this.src[this.pos] === ".") {
      isFloat = true;
      this.pos++;
      while (this.pos < this.src.length && isDigit(this.src[this.pos]!)) {
        this.pos++;
        hasDigit = true;
      }
    }
    if (this.src[this.pos] === "e" || this.src[this.pos] === "E") {
      isFloat = true;
      this.pos++;
      if (this.src[this.pos] === "+" || this.src[this.pos] === "-") this.pos++;
      while (this.pos < this.src.length && isDigit(this.src[this.pos]!)) {
        this.pos++;
      }
    }
    if (!hasDigit) throw new Error(`invalid number at ${start}`);
    const tok = this.src.slice(start, this.pos);
    if (isFloat) {
      const f = parseFloat(tok);
      if (Number.isNaN(f)) throw new Error(`parse float ${tok}`);
      return { kind: "float", value: f };
    }
    const n = Number(tok);
    if (!Number.isFinite(n)) throw new Error(`parse int ${tok}`);
    return { kind: "int", value: n };
  }

  private parseIdentOrCall(): Value {
    const start = this.pos;
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (isIdentPart(c) || c === ".") {
        this.pos++;
      } else break;
    }
    const name = this.src.slice(start, this.pos);
    if (name === "true") return { kind: "bool", value: true };
    if (name === "false") return { kind: "bool", value: false };
    if (name === "") throw new Error(`expected identifier at ${start}`);

    this.skipSpace();
    if (this.src[this.pos] === "(") {
      const seq = this.parseSeq("(", ")");
      // parseSeq always returns kind=list; safe to extract.
      const args = seq.kind === "list" ? seq.items : [];
      return { kind: "call", name, args };
    }
    return { kind: "ident", name };
  }
}

function isIdentStart(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}
function isIdentPart(c: string): boolean {
  return isIdentStart(c) || (c >= "0" && c <= "9");
}
function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

// --- Typed extractors -----------------------------------------------------

export function isNull(v: Value): boolean {
  return v.kind === "null";
}

/** Coerces strings and identifiers to their text form. */
export function asString(v: Value): string | undefined {
  if (v.kind === "string") return v.value;
  if (v.kind === "ident") return v.name;
  return undefined;
}

export function asBool(v: Value): boolean | undefined {
  return v.kind === "bool" ? v.value : undefined;
}

export function asInt(v: Value): number | undefined {
  if (v.kind === "int") return v.value;
  if (v.kind === "float") return Math.trunc(v.value);
  return undefined;
}

export function asFloat(v: Value): number | undefined {
  if (v.kind === "float") return v.value;
  if (v.kind === "int") return v.value;
  return undefined;
}

export function asList(v: Value): Value[] | undefined {
  return v.kind === "list" ? v.items : undefined;
}

/**
 * Extracts a list of strings (or string-coerced identifiers).
 * Null entries become empty strings; non-string entries make this return undefined.
 */
export function asStringList(v: Value): string[] | undefined {
  if (v.kind !== "list") return undefined;
  const out: string[] = [];
  for (const item of v.items) {
    if (item.kind === "null") {
      out.push("");
      continue;
    }
    const s = asString(item);
    if (s === undefined) return undefined;
    out.push(s);
  }
  return out;
}

export function expectString(v: Value): string {
  const s = asString(v);
  if (s === undefined) throw new Error(`expected string, got ${v.kind}`);
  return s;
}

export function expectBool(v: Value): boolean {
  const b = asBool(v);
  if (b === undefined) throw new Error(`expected bool, got ${v.kind}`);
  return b;
}

export function expectInt(v: Value): number {
  const n = asInt(v);
  if (n === undefined) throw new Error(`expected int, got ${v.kind}`);
  return n;
}

export function expectFloat(v: Value): number {
  const f = asFloat(v);
  if (f === undefined) throw new Error(`expected float, got ${v.kind}`);
  return f;
}

export function expectList(v: Value): Value[] {
  const l = asList(v);
  if (l === undefined) throw new Error(`expected list/tuple, got ${v.kind}`);
  return l;
}

/** Null is treated as an empty list — some OMC calls return nothing instead of `{}`. */
export function expectStringList(v: Value): string[] {
  if (v.kind === "null") return [];
  const list = asStringList(v);
  if (list === undefined) throw new Error(`expected list of strings, got ${v.kind}`);
  return list;
}

/** Convert a parsed Value into JSON-serializable plain data. */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function toJson(v: Value): Json {
  switch (v.kind) {
    case "string":
      return v.value;
    case "bool":
      return v.value;
    case "int":
    case "float":
      return v.value;
    case "ident":
      return v.name;
    case "list":
      return v.items.map(toJson);
    case "call":
      return { _call: v.name, args: v.args.map(toJson) };
    case "null":
      return null;
  }
}
