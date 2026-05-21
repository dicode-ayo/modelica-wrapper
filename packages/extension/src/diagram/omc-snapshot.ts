/**
 * OMC-level undo escape hatch — a deliberately coarse fallback for the
 * multi-RPC edit flows whose side effects our diff-layout undo can't see.
 *
 * The mechanism mirrors OMEdit's `OMCUndoCommand`
 * (OMEdit/OMEditLIB/Modeling/Commands.cpp:788-829): before a risky
 * multi-RPC operation, snapshot the entire backing source via
 * `listFile(className)`; on undo / rollback, replay that text with
 * `loadString(snapshot, filename)`.
 *
 * This is intentionally not a fine-grained reverse-edit — most edits should
 * still go through `diffLayouts` + targeted reverse-edits. Reach for a
 * snapshot when one of the underlying writes can fail partway and leave the
 * class in a shape the diff replay can't describe.
 */

/**
 * The slice of `OmcClient` this module depends on. Typing against a
 * structural surface (rather than the full class) keeps the primitive
 * unit-testable with a plain mock and documents exactly which calls it makes.
 *
 * `OmcClient` satisfies this interface, so existing call sites pass the real
 * client unchanged.
 */
export interface SnapshotClient {
  listFile(input: { typeName: string }): Promise<{ contents: string }>;
  getSourceFile(input: { typeName: string }): Promise<{ fileName: string }>;
  loadString(input: {
    data: string;
    filename: string;
    merge?: boolean;
  }): Promise<{ success: boolean }>;
}

/**
 * A captured class source plus the filename to replay it under. `filename`
 * is preserved from `getSourceFile` so the restored AST keeps its symbol
 * table binding (and OMC diagnostics keep pointing at the real file) rather
 * than collapsing to `<interactive>`.
 */
export interface OmcSnapshot {
  /** Fully-qualified class name the snapshot was taken from. */
  className: string;
  /** Source filename to replay under (from `getSourceFile`). */
  filename: string;
  /**
   * Pretty-printed Modelica source at capture time.
   *
   * For a package-nested class (`Pkg.Foo`) this is prefixed with a
   * `within Pkg;` clause (issue #76, item 2). `listFile(Pkg.Foo)` returns
   * only the bare `model Foo … end Foo;` body; without the `within` clause a
   * `loadString(merge=false)` replay would re-establish `Foo` at the top
   * level instead of back inside `Pkg`. The `within` tells OMC the enclosing
   * scope so the restore replaces the original package member.
   */
  contents: string;
}

/**
 * Enclosing scope of a fully-qualified class name, or `""` for a top-level
 * class. `Pkg.Sub.Foo` → `Pkg.Sub`; `Foo` → `""`.
 */
function enclosingScope(className: string): string {
  const lastDot = className.lastIndexOf(".");
  return lastDot < 0 ? "" : className.slice(0, lastDot);
}

/**
 * Prefix `contents` with a `within <scope>;` clause when the class is
 * package-nested and the listed source doesn't already carry one. A
 * top-level class (empty scope) is returned unchanged.
 */
function withWithinClause(scope: string, contents: string): string {
  if (scope.length === 0) return contents;
  // Defensive: if OMC ever starts including the clause itself, don't double it.
  if (/^\s*within\b/.test(contents)) return contents;
  return `within ${scope};\n${contents}`;
}

/**
 * Snapshot a class's backing source text before a multi-RPC edit.
 *
 * Returns `undefined` (non-fatal) when the class has no listable source —
 * e.g. a built-in class, or `listFile` came back empty. Callers treat a
 * missing snapshot as "no escape hatch available" and proceed without one.
 *
 * The filename falls back to a synthetic `<snapshot:className>` when
 * `getSourceFile` reports no file binding (classes loaded via `loadString`
 * have an empty source file). `loadString`'s filename is diagnostics-only,
 * so the synthetic value is safe for restore.
 */
export async function captureSnapshot(
  client: SnapshotClient,
  className: string,
): Promise<OmcSnapshot | undefined> {
  let contents: string;
  try {
    ({ contents } = await client.listFile({ typeName: className }));
  } catch {
    return undefined;
  }
  if (contents.length === 0) {
    return undefined;
  }

  let filename = "";
  try {
    ({ fileName: filename } = await client.getSourceFile({
      typeName: className,
    }));
  } catch {
    // Source file lookup is best-effort; fall through to the synthetic name.
    filename = "";
  }
  if (filename.length === 0) {
    filename = `<snapshot:${className}>`;
  }

  return {
    className,
    filename,
    contents: withWithinClause(enclosingScope(className), contents),
  };
}

/**
 * Restore a previously captured snapshot by reloading its source text.
 *
 * Passes `merge: false` *explicitly* (issue #76, item 2) so the captured
 * text fully replaces the class's definition rather than merging into it —
 * that's what makes this an undo rather than an additive load. The captured
 * `contents` already carries a `within` clause for package-nested classes so
 * the replacement lands back inside its enclosing package. Returns whether
 * OMC reported success.
 */
export async function restoreSnapshot(
  client: SnapshotClient,
  snapshot: OmcSnapshot,
): Promise<boolean> {
  const { success } = await client.loadString({
    data: snapshot.contents,
    filename: snapshot.filename,
    merge: false,
  });
  return success;
}
