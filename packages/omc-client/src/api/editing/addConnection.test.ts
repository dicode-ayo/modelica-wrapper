/**
 * `addConnection` screens the write before sending it: OMC answers `true` for
 * a duplicate connection, an undeclared endpoint and a class that is not
 * loaded, so each must be refused here or it reaches the model.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";

import { addConnection } from "./addConnection.js";

interface ClassFixture {
  components?: string[];
  connections?: [string, string][];
  inherits?: string[];
}

/**
 * A CallContext answering the screen's reads from `classes` (keyed by
 * qualified name), and `"true"` to the write itself.
 */
function stubCtx(opts: {
  classes: Record<string, ClassFixture>;
  fail?: string;
}): { ctx: CallContext; sent: string[] } {
  const sent: string[] = [];
  const argsOf = (cmd: string): string[] =>
    cmd.slice(cmd.indexOf("(") + 1, -1).split(", ");
  const argOf = (cmd: string): string => argsOf(cmd).at(0) ?? "";
  const ctx: CallContext = {
    async call(cmd) {
      sent.push(cmd);
      if (opts.fail !== undefined && cmd.startsWith(opts.fail)) {
        throw new Error("transport closed");
      }
      const cls = opts.classes[argOf(cmd)];
      if (cmd.startsWith("existClass(")) return String(cls !== undefined);
      if (cmd.startsWith("getConnectionCount(")) {
        return String(cls?.connections?.length ?? 0);
      }
      if (cmd.startsWith("getNthConnection(")) {
        const index = Number(argsOf(cmd).at(1));
        const row = cls?.connections?.at(index - 1);
        if (row === undefined) return "{}";
        return `{"${row[0]}", "${row[1]}", ""}`;
      }
      if (cmd.startsWith("getComponents(")) {
        const rows = (cls?.components ?? []).map(
          (n) =>
            `{P.C, ${n}, "", "public", false, false, false, false, "unspecified", "none", "unspecified", {}}`,
        );
        return `{${rows.join(", ")}}`;
      }
      if (cmd.startsWith("getInheritedClasses(")) {
        return `{${(cls?.inherits ?? []).join(", ")}}`;
      }
      return "true";
    },
    async getErrorString() {
      return { errorString: "" };
    },
  };
  return { ctx, sent };
}

const wrote = (sent: string[]): boolean =>
  sent.some((cmd) => cmd.startsWith("addConnection("));

describe("addConnection: pre-write screen", () => {
  it("refuses a class that is not loaded", async () => {
    const { ctx, sent } = stubCtx({ classes: {} });
    const out = await addConnection(ctx, {
      from: "a",
      to: "b",
      typeName: "P.Missing",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: "P.Missing is not a loaded class",
    });
    expect(wrote(sent)).toBe(false);
  });

  it("refuses a connection the class already has", async () => {
    const { ctx, sent } = stubCtx({
      classes: {
        "P.M": { components: ["a", "b"], connections: [["a.p", "b.n"]] },
      },
    });
    const out = await addConnection(ctx, {
      from: "a.p",
      to: "b.n",
      typeName: "P.M",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: "P.M already connects a.p and b.n",
    });
    expect(wrote(sent)).toBe(false);
  });

  it("refuses the same connection written the other way round", async () => {
    const { ctx, sent } = stubCtx({
      classes: {
        "P.M": { components: ["a", "b"], connections: [["a.p", "b.n"]] },
      },
    });
    const out = await addConnection(ctx, {
      from: "b.n",
      to: "a.p",
      typeName: "P.M",
    });
    expect(out.success).toBe(false);
    expect(wrote(sent)).toBe(false);
  });

  it("refuses a duplicate whose subscript spacing differs from OMC's", async () => {
    const { ctx, sent } = stubCtx({
      classes: {
        "P.M": { components: ["arr", "b"], connections: [["arr[1,2].p", "b"]] },
      },
    });
    const out = await addConnection(ctx, {
      from: "arr[1, 2].p",
      to: "b",
      typeName: "P.M",
    });
    expect(out.success).toBe(false);
    expect(wrote(sent)).toBe(false);
  });

  it("refuses a connection a base class already makes", async () => {
    const { ctx, sent } = stubCtx({
      classes: {
        "P.M": { components: ["d"], inherits: ["P.Base"] },
        "P.Base": { components: ["a", "b"], connections: [["a", "b"]] },
      },
    });
    const out = await addConnection(ctx, {
      from: "b",
      to: "a",
      typeName: "P.M",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: "P.M already connects b and a",
    });
    expect(wrote(sent)).toBe(false);
  });

  it("refuses an endpoint whose component the class does not declare", async () => {
    const { ctx, sent } = stubCtx({
      classes: { "P.M": { components: ["a"] } },
    });
    const out = await addConnection(ctx, {
      from: "a.p",
      to: "nope.n",
      typeName: "P.M",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: "P.M declares no component named nope",
    });
    expect(wrote(sent)).toBe(false);
  });

  it("checks a subscripted endpoint by its component, not the element", async () => {
    const { ctx, sent } = stubCtx({
      classes: { "P.M": { components: ["load", "p"] } },
    });
    const out = await addConnection(ctx, {
      from: "load[2].p",
      to: "p",
      typeName: "P.M",
    });
    expect(out).toEqual({ success: true });
    expect(wrote(sent)).toBe(true);
  });

  it("accepts a component inherited through a chain of extends", async () => {
    const { ctx, sent } = stubCtx({
      classes: {
        "P.M": { components: ["d"], inherits: ["P.Mid"] },
        "P.Mid": { inherits: ["P.Base"] },
        "P.Base": { components: ["a"] },
      },
    });
    const out = await addConnection(ctx, {
      from: "a.p",
      to: "d.n",
      typeName: "P.M",
    });
    expect(out).toEqual({ success: true });
    expect(wrote(sent)).toBe(true);
  });

  it("accepts a member of an expandable connector bus that nothing declares", async () => {
    const { ctx, sent } = stubCtx({
      classes: { "P.M": { components: ["bus", "a"] } },
    });
    const out = await addConnection(ctx, {
      from: "bus.undeclaredSignal",
      to: "a.y",
      typeName: "P.M",
    });
    expect(out).toEqual({ success: true });
    expect(wrote(sent)).toBe(true);
  });

  it("matches a quoted component name as OMC reports it", async () => {
    const { ctx, sent } = stubCtx({
      classes: { "P.M": { components: ["'q.r'", "a"] } },
    });
    const out = await addConnection(ctx, {
      from: "'q.r'.p",
      to: "a",
      typeName: "P.M",
    });
    expect(out).toEqual({ success: true });
    expect(wrote(sent)).toBe(true);
  });

  it("terminates on an inheritance cycle", async () => {
    const { ctx } = stubCtx({
      classes: {
        "P.M": { components: ["a"], inherits: ["P.Loop"] },
        "P.Loop": { inherits: ["P.M"] },
      },
    });
    const out = await addConnection(ctx, {
      from: "a",
      to: "zz",
      typeName: "P.M",
    });
    expect(out.success).toBe(false);
  });

  it("refuses rather than writing when a screening read fails", async () => {
    const { ctx, sent } = stubCtx({
      classes: { "P.M": { components: ["a", "b"] } },
      fail: "getConnectionCount(",
    });
    const out = await addConnection(ctx, {
      from: "a",
      to: "b",
      typeName: "P.M",
    });
    expect(out).toEqual({
      success: false,
      diagnostic: "could not verify the write is safe: transport closed",
    });
    expect(wrote(sent)).toBe(false);
  });

  it("sends the write with the default Line annotation once screened", async () => {
    const { ctx, sent } = stubCtx({
      classes: {
        "P.M": { components: ["a", "b", "c"], connections: [["a.p", "c.n"]] },
      },
    });
    await addConnection(ctx, { from: "a.p", to: "b.n", typeName: "P.M" });
    expect(sent.at(-1)).toBe("addConnection(a.p, b.n, P.M, annotate=Line())");
  });
});
