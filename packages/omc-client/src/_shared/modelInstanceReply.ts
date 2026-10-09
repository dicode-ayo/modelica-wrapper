import { existClass } from "../api/browsing/existClass.js";
import { OmcDiagnosticError } from "../diagnostic-error.js";
import { expectString, isNull, parse } from "../parse.js";

import type { CallContext } from "./callContext.js";
import { ModelInstanceNotFoundError } from "./modelInstance.js";

/**
 * Unwraps the Modelica string literal around a `getModelInstance`/
 * `getModelInstanceAnnotation` reply into its JSON text.
 *
 * OMC replies empty both for a class it doesn't know and for a loaded class
 * that fails to instantiate (e.g. a missing base class), so an empty reply is
 * told apart by `existClass`. The error buffer can't name the instantiation
 * failure: OMC reports it only on a class's first elaboration, and nothing
 * clears the buffer before this call, so its text may belong to an earlier one.
 */
export async function modelInstanceJson(
  ctx: CallContext,
  raw: string,
  fnName: string,
  className: string,
): Promise<string> {
  const value = parse(raw);
  if (!isNull(value)) return expectString(value);
  const { exists } = await existClass(ctx, { typeName: className });
  if (!exists) throw new ModelInstanceNotFoundError(className);
  throw new OmcDiagnosticError(
    `${fnName}: OMC returned no model instance for "${className}". The class is loaded but fails to instantiate; check it for errors.`,
  );
}
