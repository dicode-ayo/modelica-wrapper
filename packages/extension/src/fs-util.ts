/**
 * Filesystem helpers shared across the extension. No `vscode` import.
 *
 * `pathExists` lives in `@dicode/omc-client` so the class-persistence helpers
 * there share this one implementation; it is re-exported here because this is
 * where the extension's callers look for it.
 */

export { pathExists } from "@dicode/omc-client";
