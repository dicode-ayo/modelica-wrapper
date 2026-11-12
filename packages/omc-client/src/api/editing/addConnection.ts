/**
 * OMC: `function addConnection`
 *
 * Add a `connect(from, to)` to a class with optional Line annotation.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { connectionAnnotation, modelicaName } from "../../_shared/fields.js";
import { SuccessWithDiagnosticOutput } from "../../_shared/outputs.js";
import {
  parseMutationDiagnostic,
  parseOutput,
} from "../../_shared/parseOutput.js";
import { existClass } from "../browsing/existClass.js";
import { getInheritedClasses } from "../browsing/getInheritedClasses.js";
import { getComponents } from "../contents/getComponents.js";
import { getConnectionCount } from "../contents/getConnectionCount.js";
import { getNthConnection } from "../contents/getNthConnection.js";

export const AddConnectionInputSchema = z.strictObject({
  from: modelicaName.describe(
    "Left-hand-side connector reference for the new connection.",
  ),
  to: modelicaName.describe(
    "Right-hand-side connector reference for the new connection.",
  ),
  typeName: modelicaName.describe("Class to which the connection is added."),
  annotation: connectionAnnotation,
});
export type AddConnectionInput = z.input<typeof AddConnectionInputSchema>;

export const AddConnectionOutputSchema = SuccessWithDiagnosticOutput;
export type AddConnectionOutput = z.infer<typeof AddConnectionOutputSchema>;

export const AddConnectionDescription =
  "Add a `connect(from, to)` to the given class with an optional Line annotation; refuses a class that is not loaded, a connection the class already has (in either orientation), or an endpoint whose leading component the class does not declare or inherit.";

/**
 * The component an endpoint starts at: its first segment, subscript dropped
 * (`load[2].p` → `load`). Only this is checked — past it, an expandable
 * connector bus admits members nothing declares. A quoted head is returned
 * without its quotes, which is how the reply parser hands back the name
 * `getComponents` reports.
 */
const HEAD =
  /^(?:([A-Za-z_][A-Za-z0-9_]*)|'((?:[^'\\]|\\.)+)')(?:\[[^\]]*\])?(?:\.|$)/;

function headOf(endpoint: string): string | undefined {
  const match = HEAD.exec(endpoint);
  return match?.[1] ?? match?.[2];
}

/** OMC reprints a subscript with its own spacing when it reads one back. */
function sameEndpoint(a: string, b: string): boolean {
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

interface Declared {
  names: Set<string>;
  connections: { from: string; to: string }[];
}

/**
 * The component names and connections `typeName` declares or inherits, read
 * class by class through the `extends` chain. `getComponents` and
 * `getNthConnection` report only what a class declares locally.
 * `getConnectionList` would include inherited connections in one call, but it
 * instantiates the class and fails outright once any connection in it is
 * invalid, which would refuse every later write to a class that is already
 * broken. `getInheritedClasses` answers with qualified names and resolves
 * through a short class definition, but drops a base it cannot find, so what
 * an unloaded base declares is not seen.
 */
async function declared(ctx: CallContext, typeName: string): Promise<Declared> {
  const names = new Set<string>();
  const connections: Declared["connections"] = [];
  const visited = new Set<string>();
  const pending = [typeName];
  for (let cls = pending.pop(); cls !== undefined; cls = pending.pop()) {
    if (visited.has(cls)) continue;
    visited.add(cls);
    const { components } = await getComponents(ctx, { typeName: cls });
    for (const c of components) names.add(c.name);
    const { count } = await getConnectionCount(ctx, { typeName: cls });
    for (let index = 1; index <= count; index++) {
      connections.push(await getNthConnection(ctx, { typeName: cls, index }));
    }
    const { inheritedClasses } = await getInheritedClasses(ctx, {
      typeName: cls,
    });
    pending.push(...inheritedClasses);
  }
  return { names, connections };
}

/** A connection a base class already makes is refused as a duplicate too. */
async function screenReasonToRefuse(
  ctx: CallContext,
  input: AddConnectionInput,
): Promise<string | undefined> {
  try {
    const { exists } = await existClass(ctx, { typeName: input.typeName });
    if (!exists) return `${input.typeName} is not a loaded class`;

    const { names, connections } = await declared(ctx, input.typeName);
    const duplicate = connections.some(
      (c) =>
        (sameEndpoint(c.from, input.from) && sameEndpoint(c.to, input.to)) ||
        (sameEndpoint(c.from, input.to) && sameEndpoint(c.to, input.from)),
    );
    if (duplicate) {
      return `${input.typeName} already connects ${input.from} and ${input.to}`;
    }

    for (const endpoint of [input.from, input.to]) {
      const head = headOf(endpoint);
      if (head !== undefined && !names.has(head)) {
        return `${input.typeName} declares no component named ${head}`;
      }
    }

    return undefined;
  } catch (err) {
    return `could not verify the write is safe: ${detail(err)}`;
  }
}

function detail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * OMC answers `success: true` for a duplicate connection, for an endpoint the
 * class does not declare, and for a class that is not loaded (writing
 * nothing) — the first two only surface at the next checkModel.
 */
export async function addConnection(
  ctx: CallContext,
  input: AddConnectionInput,
): Promise<AddConnectionOutput> {
  const refusal = await screenReasonToRefuse(ctx, input);
  if (refusal !== undefined) {
    return { success: false, diagnostic: refusal };
  }

  const annotation = input.annotation ?? "";
  const ann = annotation === "" ? "annotate=Line()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `addConnection(${input.from}, ${input.to}, ${input.typeName}, ${ann})`,
  );
  return parseOutput(
    AddConnectionOutputSchema,
    parseMutationDiagnostic(raw),
    "addConnection",
  );
}
