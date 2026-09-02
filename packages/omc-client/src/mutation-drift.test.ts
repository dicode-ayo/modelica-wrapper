/**
 * The argument positions in `MUTATIONS` restate each wrapper's argument order,
 * which lives in a template literal one directory over with nothing tying the
 * two together. Reordering a wrapper's arguments would still compile and still
 * announce — naming the wrong class, which the table's own doc calls worse
 * than coarse.
 *
 * So every positional entry is driven through the wrapper that builds its
 * command, with a sentinel where the class or file belongs, and the
 * announcement has to come back naming that sentinel.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "./_shared/callContext.js";
import type { OmcFunction } from "./commands.js";
import { MUTATIONS, mutationFor } from "./mutation.js";
import { REGISTRY, type OmcFnName } from "./registry.js";

const CLASS = "Probe.Cls";
const FILE = "/probe/File.mo";

const TRANSITION = {
  from: "s1",
  to: "s2",
  immediate: true,
  reset: true,
  synchronize: false,
};

/** One input per positional entry, with the sentinel in the field it maps to. */
const PROBES: Record<string, Record<string, unknown>> = {
  loadFile: { fileName: FILE },
  loadString: { data: "model X end X;", filename: FILE },
  newModel: { typeName: CLASS, withinPath: "Probe" },
  deleteClass: { typeName: CLASS },
  setSourceFile: { typeName: CLASS, fileName: "/elsewhere.mo" },
  loadClassContentString: { data: "model X end X;", typeName: CLASS },
  setParameterValue: { typeName: CLASS, variableName: "r", value: "1" },
  setComponentModifierValue: { typeName: CLASS, modifier: "r.R", expr: "1" },
  removeComponentModifiers: { typeName: CLASS, componentName: "r" },
  setExtendsModifierValue: {
    typeName: CLASS,
    extendsBase: "Probe.Base",
    modifier: "r.R",
    expr: "1",
  },
  removeExtendsModifiers: { typeName: CLASS, extendsBase: "Probe.Base" },
  setExtendsModifier: {
    typeName: CLASS,
    extendsName: "Probe.Base",
    modifier: "r.R",
  },
  setElementModifierValue: { typeName: CLASS, elementName: "r.R", expr: "1" },
  setElementAnnotation: { typeName: CLASS, annotationMod: "annotate(Icon())" },
  setElementType: { typeName: CLASS, newTypeName: "Probe.Other" },
  removeElementModifiers: { typeName: CLASS, componentName: "r" },
  addComponent: {
    componentName: "r",
    componentClass: "Probe.Other",
    intoTypeName: CLASS,
  },
  deleteComponent: { componentName: "r", typeName: CLASS },
  renameComponent: { typeName: CLASS, oldName: "a", newName: "b" },
  updateComponent: {
    componentName: "r",
    componentClass: "Probe.Other",
    intoTypeName: CLASS,
  },
  addConnection: { from: "a.p", to: "b.n", typeName: CLASS },
  deleteConnection: { from: "a.p", to: "b.n", typeName: CLASS },
  updateConnection: { typeName: CLASS, from: "a.p", to: "b.n" },
  updateConnectionNames: {
    typeName: CLASS,
    from: "a.p",
    to: "b.n",
    fromNew: "c.p",
    toNew: "d.n",
  },
  addTransition: {
    typeName: CLASS,
    ...TRANSITION,
    condition: "x > 1",
    priority: 1,
  },
  deleteTransition: {
    typeName: CLASS,
    ...TRANSITION,
    condition: "x > 1",
    priority: 1,
  },
  updateTransition: {
    typeName: CLASS,
    from: TRANSITION.from,
    to: TRANSITION.to,
    oldCondition: "x > 1",
    oldImmediate: true,
    oldReset: true,
    oldSynchronize: false,
    oldPriority: 1,
    newCondition: "x > 2",
    newImmediate: true,
    newReset: true,
    newSynchronize: false,
    newPriority: 2,
  },
  addClassAnnotation: { typeName: CLASS, annotation: "annotate(Icon())" },
  setComponentProperties: {
    typeName: CLASS,
    componentName: "r",
    finalPrefix: false,
    flow: false,
    stream: false,
    protectedPrefix: false,
    replaceablePrefix: false,
    variability: "parameter",
    inner: false,
    outer: false,
    direction: "",
  },
  setComponentDimensions: {
    typeName: CLASS,
    componentName: "r",
    dimensions: ["2"],
  },
  setComponentComment: { typeName: CLASS, componentName: "r", comment: "c" },
  setClassComment: { typeName: CLASS, filename: "c" },
  setDocumentationAnnotation: { typeName: CLASS, info: "i", revisions: "r" },
  addInitialState: { typeName: CLASS, state: "s" },
  deleteInitialState: { typeName: CLASS, state: "s" },
  updateInitialState: { typeName: CLASS, state: "s" },
  renameComponentInClass: { typeName: CLASS, oldName: "a", newName: "b" },
};

/** Captures the command a wrapper builds; its reply is never the point. */
async function commandFor(
  fn: OmcFnName,
  input: Record<string, unknown>,
): Promise<string> {
  const sent: string[] = [];
  const ctx: CallContext = {
    call: (cmd) => {
      sent.push(cmd);
      return Promise.resolve("true");
    },
    getErrorString: () => Promise.resolve({ errorString: "" }),
  };
  const entry = REGISTRY[fn];
  type AnyFn = (ctx: CallContext, input: unknown) => Promise<unknown>;
  // The wrapper builds its command before it reads the reply, so a response
  // it cannot parse still leaves the command recorded.
  await (entry.fn as AnyFn)(ctx, entry.inputSchema.parse(input)).catch(
    () => undefined,
  );
  const [cmd] = sent;
  if (cmd === undefined) throw new Error(`${fn} sent no command`);
  return cmd;
}

const positional = Object.entries(MUTATIONS).filter(
  ([, entry]) => typeof entry === "object",
);

describe("positional entries against the wrappers that build the commands", () => {
  it("probes every positional entry", () => {
    expect(Object.keys(PROBES).sort()).toEqual(
      positional.map(([name]) => name).sort(),
    );
  });

  it.each(positional)("%s", async (name, entry) => {
    if (typeof entry !== "object") throw new Error("filtered above");
    const probe = PROBES[name];
    if (probe === undefined) throw new Error(`no probe for ${name}`);

    const mutation = mutationFor(await commandFor(name as OmcFnName, probe));

    expect(mutation).toEqual({
      fn: name as OmcFunction,
      scope:
        entry.as === "class"
          ? { kind: "class", className: CLASS }
          : { kind: "file", fileName: FILE },
    });
  });
});
