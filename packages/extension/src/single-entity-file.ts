/**
 * Modelica spec §13.2.2.2: a nonstructured entity — a plain `.mo` file — holds
 * one stored-definition, defining a class whose name matches the file. OMC's
 * `loadFile` accepts a file declaring several top-level classes anyway, and
 * once it has, those classes share one `getSourceFile` path with no dotted
 * relationship to climb between them: saving any one of them rewrites the file
 * from that class alone and drops the rest (issue #452).
 *
 * OMEdit refuses such a file at the door rather than reconciling it on save
 * (`LibraryWidget::multipleTopLevelClasses`), directing the user to scripting
 * `loadFile` instead. The load paths behind the UI do the same; the REPL is
 * that scripting environment and stays open.
 */

import { errorDetail } from "./error-detail.js";
import { log } from "./logger.js";

/** OMC surface the check calls. `OmcClient` satisfies it structurally. */
export interface FileParseClient {
  parseFile(input: { fileName: string }): Promise<{ classNames: string[] }>;
}

/**
 * The top-level classes `fileName` declares when it declares more than one,
 * `undefined` when it holds a single entity. A file OMC cannot parse answers
 * `undefined`: whatever load follows reports that parse failure with more
 * context than a refusal here could.
 */
export async function multipleTopLevelClasses(
  client: FileParseClient,
  fileName: string,
): Promise<string[] | undefined> {
  let classNames: string[];
  try {
    ({ classNames } = await client.parseFile({ fileName }));
  } catch (err) {
    log.warn(
      "singleEntity",
      `parseFile ${fileName} failed: ${errorDetail(err)}`,
    );
    return undefined;
  }
  return classNames.length > 1 ? classNames : undefined;
}

/** Shared refusal wording, so every guard site names the same recovery. */
export function multiEntityMessage(
  fileName: string,
  classNames: string[],
): string {
  return (
    `${fileName} declares more than one top-level class ` +
    `(${classNames.join(", ")}). Modelica stores one class per file, and ` +
    `saving any one of them here would drop the others — split them into a ` +
    `file each, or load the file through the Modelica REPL.`
  );
}
