import type { CallContext } from "./callContext.js";
import { ModelInstanceNotFoundError } from "./modelInstance.js";
import { failureReason, NO_REASON } from "./parseOutput.js";
import { OmcDiagnosticError } from "../error-buffer.js";
import { expectString, parse } from "../parse.js";
import { existClass } from "../api/browsing/existClass.js";

/**
 * Unwraps the Modelica string literal around a `getModelInstance`/
 * `getModelInstanceAnnotation` reply into its JSON text.
 *
 * OMC replies empty both for a class it doesn't know and for a loaded class
 * that fails to instantiate (e.g. a missing base class), so an empty reply is
 * told apart by `existClass`. The buffer is drained first in either case, so a
 * stale "not found" diagnostic doesn't reach the next caller.
 */
export async function modelInstanceJson(
  ctx: CallContext,
  raw: string,
  fnName: string,
  className: string,
): Promise<string> {
  const value = parse(raw);
  if (value.kind !== "null") return expectString(value);
  const reason = await failureReason(ctx);
  const { exists } = await existClass(ctx, { typeName: className });
  if (!exists) throw new ModelInstanceNotFoundError(className);
  throw new OmcDiagnosticError(`${fnName}: ${reason ?? NO_REASON}`);
}
