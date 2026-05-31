/**
 * Parser for OMC's Modelica-syntax RPC responses.
 *
 * OMC returns Modelica-syntax expressions, not JSON. The shapes we encounter:
 *
 *     "foo"                           StringV
 *     'foo bar'                       IdentV (Q-IDENT, Modelica spec §2.3.1)
 *     true / false                    BoolV
 *     42 / 1.5 / 1e-6                 IntV / FloatV
 *     {a, b, c}                       ListV (brace list)
 *     ("x", 1, true)                  ListV (paren tuple — same TS type)
 *     Modelica.Blocks.Math.Sin        IdentV
 *     .OpenModelica.Scripting.X.tag   IdentV (leading-dot fully-qualified names; enum literals)
 *     $Any / $Code                    IdentV (OMC builtin names start with `$`)
 *     Polygon(true, {0,0}, ...)       CallV (used inside icon annotations)
 *     rec(name=value, ...)            CallV with KwargV entries (getElementsInfo)
 *     record Name field=v, ... end Name;   CallV with name=Name and KwargV entries
 *                                          (legacy diagnostic-only record syntax used
 *                                          by `getMessagesStringInternal`)
 *     -      (between commas)         NullV
 *
 * Brace lists and paren tuples are both represented as `list`; consumers
 * disambiguate by knowing what shape each OMC call returns.
 *
 * Coverage: tracks OMPython's `OMTypedParser.py` (the de-facto authoritative
 * parser; OMC's interactive RPC grammar is not formally documented). We are
 * wider than OMTypedParser on `$`-idents, free-floating kwargs in parens,
 * bare-`-` null sentinels, leading-dot qualified idents, `record … end Name;`
 * blocks, and bare leading-`=` modification bindings (the `= 1.0` inside
 * `$Code( = 1.0)` emitted by `getNthComponentModification`, parsed as a
 * `call` named "=" with the bound value as its single arg) — productions OMC
 * actually emits.
 */

export type Value =
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "int"; value: number }
  | { kind: "float"; value: number }
  | { kind: "ident"; name: string }
  | { kind: "list"; items: Value[] }
  | { kind: "call"; name: string; args: Value[] }
  | { kind: "kwarg"; name: string; value: Value }
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
    throw new Error(
      `unexpected trailing input at ${p.pos}: ${JSON.stringify(p.peek(20))}`,
    );
  }
  return v;
}

/**
 * Parse the leading Value from `src` and return both the value and any
 * remaining (trimmed) trailing text.
 *
 * Unlike `parse`, this never throws on trailing input. Use it for OMC
 * calls that may emit a diagnostic line after the documented return
 * value — e.g. some mutations (`addComponent`, `addConnection`)
 * append "Error occurred …" to the response when the call fails,
 * which would otherwise crash strict `parse()` before the caller can
 * inspect the boolean.
 *
 * Empty / whitespace input yields a null Value with empty trailing.
 */
export function parseLeading(src: string): { value: Value; trailing: string } {
  const text = src.trim();
  if (text === "") return { value: NULL, trailing: "" };
  const p = new Parser(text);
  const v = p.value();
  p.skipSpace();
  return { value: v, trailing: p.src.slice(p.pos).trim() };
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
    if (c === "'") return this.parseQuotedIdent();
    if (c === "{") return this.parseSeq("{", "}");
    if (c === "(") return this.parseSeq("(", ")");
    // Leading-dot qualified ident: `.OpenModelica.Scripting.ErrorKind.syntax`.
    // OMC emits these for fully-qualified enum literals in diagnostic records.
    if (c === ".") return this.parseIdentOrCall();

    if (c === "-" || c === "+" || (c >= "0" && c <= "9")) {
      if (c === "-" && this.isNullDash()) {
        this.pos++;
        return NULL;
      }
      return this.parseNumber();
    }

    if (isIdentStart(c)) {
      // The keyword `record` opens a block `record <Name> kw=v, ... end <Name>;`
      // which OMC uses for legacy diagnostic-record responses (e.g.
      // `getMessagesStringInternal`). Detect it before the generic ident path.
      if (this.peekKeyword("record")) {
        return this.parseRecordBlock();
      }
      return this.parseIdentOrCall();
    }

    throw new Error(`unexpected char ${JSON.stringify(c)} at pos ${this.pos}`);
  }

  /** True if the next token at `pos` is the bare keyword `kw` (followed by whitespace). */
  private peekKeyword(kw: string): boolean {
    if (this.src.slice(this.pos, this.pos + kw.length) !== kw) return false;
    const after = this.src[this.pos + kw.length];
    if (after === undefined) return false;
    // Keyword boundary: whitespace or end. Any ident-continuation char means
    // this is just an ident that happens to start with `record…`.
    return (
      after === " " ||
      after === "\t" ||
      after === "\n" ||
      after === "\r" ||
      after === "\v" ||
      after === "\f"
    );
  }

  /**
   * Parse `record <DottedName> kw=v, kw=v, ... end <DottedName>;` and return
   * a `call` Value whose name is the record's type name and whose args are
   * the kwarg entries — i.e. the same shape we'd produce for `Name(kw=v,...)`.
   *
   * Trailing semicolons are tolerated; the closing `end <Name>;` consumes its
   * terminator if present so the parent list/kwarg sees a clean boundary.
   */
  private parseRecordBlock(): Value {
    // Consume `record`.
    this.pos += "record".length;
    this.skipSpace();
    // Parse the record type name (dotted ident, possibly leading-dot).
    const typeName = this.readDottedName();
    this.skipSpace();
    const kwargs: Value[] = [];
    while (this.pos < this.src.length) {
      this.skipSpace();
      // `end <Name>;` terminates the block.
      if (this.peekKeyword("end")) {
        this.pos += "end".length;
        this.skipSpace();
        // Consume (and ignore) the closing type name.
        this.readDottedName();
        this.skipSpace();
        // Optional trailing semicolon.
        if (this.src[this.pos] === ";") this.pos++;
        return { kind: "call", name: typeName, args: kwargs };
      }
      // Each entry: `<ident> = <value>` optionally followed by `,`.
      const fieldName = this.readDottedName();
      if (fieldName === "") {
        throw new Error(
          `expected field name at ${this.pos} inside record block`,
        );
      }
      this.skipSpace();
      if (this.src[this.pos] !== "=") {
        throw new Error(
          `expected '=' after record field ${JSON.stringify(fieldName)} at ${this.pos}`,
        );
      }
      this.pos++;
      const rhs = this.value();
      kwargs.push({ kind: "kwarg", name: fieldName, value: rhs });
      this.skipSpace();
      if (this.src[this.pos] === ",") {
        this.pos++;
        continue;
      }
      // No comma — next iteration should hit `end` or another field.
    }
    throw new Error("unterminated record block (missing `end <Name>;`)");
  }

  /**
   * Read a possibly-leading-dot dotted ident (e.g. `foo`, `Modelica.Blocks.M.Gain`,
   * `.OpenModelica.Scripting.ErrorKind.syntax`). Returns the raw text including
   * the leading dot, if any. Caller is responsible for trimming if needed.
   */
  private readDottedName(): string {
    const start = this.pos;
    if (this.src[this.pos] === ".") this.pos++;
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (isIdentPart(c) || c === ".") {
        this.pos++;
      } else break;
    }
    return this.src.slice(start, this.pos);
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
    return { kind: "string", value: this.readQuoted('"') };
  }

  /** Q-IDENT per Modelica spec §2.3.1 — same escape rules as strings. */
  private parseQuotedIdent(): Value {
    return { kind: "ident", name: this.readQuoted("'") };
  }

  /** Reads `<quote>…<quote>` and returns the unescaped body. Consumes both quotes. */
  private readQuoted(quote: '"' | "'"): string {
    if (this.src[this.pos] !== quote) {
      throw new Error(`expected ${quote} at ${this.pos}`);
    }
    const start = this.pos;
    this.pos++;
    let out = "";
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === quote) {
        this.pos++;
        return out;
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
    throw new Error(`unterminated ${quote}…${quote} starting at ${start}`);
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
      // Leading-`=` modification binding, e.g. the `= 1.0` inside
      // `$Code( = 1.0)` returned by `getNthComponentModification`. Modelica's
      // modification syntax allows a bare binding with no LHS ident; OMC emits
      // it verbatim. Represent it as a `call` named "=" with the bound value as
      // its single arg so callers can recognise the binding form.
      if (this.src[this.pos] === "=") {
        this.pos++;
        const bound = this.value();
        items.push({ kind: "call", name: "=", args: [bound] });
        this.skipSpace();
        if (this.pos < this.src.length && this.src[this.pos] === ",") {
          this.pos++;
        }
        continue;
      }
      const head = this.value();
      this.skipSpace();
      if (
        head.kind === "ident" &&
        this.pos < this.src.length &&
        this.src[this.pos] === "="
      ) {
        this.pos++;
        const rhs = this.value();
        items.push({ kind: "kwarg", name: head.name, value: rhs });
        this.skipSpace();
      } else {
        items.push(head);
      }
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
    // Allow a single leading `.` for fully-qualified names like
    // `.OpenModelica.Scripting.ErrorKind.syntax`.
    if (this.src[this.pos] === ".") this.pos++;
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
  return (
    (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$"
  );
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
  if (list === undefined)
    throw new Error(`expected list of strings, got ${v.kind}`);
  return list;
}

/** Convert a parsed Value into JSON-serializable plain data. */
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };

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
    case "kwarg":
      return { _kwarg: v.name, value: toJson(v.value) };
    case "null":
      return null;
  }
}
