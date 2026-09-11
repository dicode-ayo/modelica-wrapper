/**
 * The verdict vocabulary the write gate speaks, named here rather than imported
 * so this package carries no editor dependency.
 *
 * These are the structural shapes a host supplies. The VSCode extension's
 * `WriteVerdicts` satisfies {@link WriteVerdictSource} as it stands — it
 * combines a class's origin with its file permission and carries the refusal
 * sentence — and a host with no editor can satisfy it from the filesystem
 * alone.
 */

/** Whether a class may be written, and what to say when it may not. */
export type WriteVerdict = { ok: true } | { ok: false; reason: string };

/** What the caller was about to do; selects the verb phrase in a refusal. */
export type WriteAction = "edit" | "save" | "createInside";

/** The subset of OMC a verdict is derived from. */
export interface WriteVerdictClient {
  getSourceFile(input: { typeName: string }): Promise<{ fileName: string }>;
  getModelicaPath(): Promise<{ modelicaPath: string }>;
  getClassInformation(input: {
    typeName: string;
  }): Promise<{ fileReadOnly: boolean }>;
}

/** Answers "may this class be written?" for one class at a time. */
export interface WriteVerdictSource {
  forClass(
    client: WriteVerdictClient,
    className: string,
    action: WriteAction,
  ): Promise<WriteVerdict>;
}
