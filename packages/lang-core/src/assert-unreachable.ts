/**
 * Assert that a union has been handled exhaustively.
 *
 * Call it where control flow can only arrive with every case already covered —
 * a `default:` arm, or the tail of an if/else chain. `value` is typed `never`,
 * so adding a member to the union turns the call into a compile error naming
 * the type that no longer fits; without it, the new member falls through
 * silently.
 *
 * It also throws, because "impossible" holds only as far as the type system
 * reaches. Data crossing a runtime boundary — a webview message, an OMC reply,
 * a persisted document — can carry a value the union doesn't describe, and
 * there `never` is a claim, not a guarantee. Use a tolerant branch for those
 * rather than this.
 *
 * ```ts
 * switch (edit.kind) {
 *   case "add": return applyAdd(edit);
 *   case "delete": return applyDelete(edit);
 *   default: assertUnreachable(edit, "LayoutEdit");
 * }
 * ```
 */
export function assertUnreachable(value: never, subject?: string): never {
  const rendered = renderValue(value);
  throw new Error(
    subject === undefined
      ? `Unreachable: unhandled ${rendered}`
      : `Unreachable: unhandled ${subject} ${rendered}`,
  );
}

/** Best-effort rendering — a cyclic or exotic value must not mask the error. */
function renderValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
