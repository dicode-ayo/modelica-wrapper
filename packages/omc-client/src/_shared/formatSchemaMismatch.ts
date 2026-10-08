import type { z } from "zod";

const MAX_LINES = 10;

interface Leaf {
  path: PropertyKey[];
  message: string;
}

function depth(leaves: readonly Leaf[]): number {
  return leaves.reduce((max, leaf) => Math.max(max, leaf.path.length), 0);
}

function collect(
  issues: readonly z.core.$ZodIssue[],
  prefix: PropertyKey[],
): Leaf[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    const fallback = [{ path, message: issue.message }];
    if (issue.code === "invalid_key" || issue.code === "invalid_element") {
      const nested = collect(issue.issues, path);
      return nested.length > 0 ? nested : fallback;
    }
    if (issue.code !== "invalid_union" || issue.errors.length === 0) {
      return fallback;
    }
    // A union reports one issue list per branch; the branch that got
    // furthest into the value is the one the input was closest to matching.
    // Strict `>` keeps the earliest branch on a tie, so output is stable.
    const best = issue.errors
      .map((branch) => collect(branch, path))
      .reduce<Leaf[]>(
        (acc, branch) => (depth(branch) > depth(acc) ? branch : acc),
        [],
      );
    return best.length > 0 ? best : fallback;
  });
}

function renderPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === "number") return `${acc}[${seg}]`;
    const name = String(seg);
    return acc === "" ? name : `${acc}.${name}`;
  }, "");
}

/**
 * Renders a failed Zod parse as one `path: message` line per leaf issue
 * under a header naming the OMC call, so the text stays legible in a UI
 * surface where Zod's own JSON message is not.
 */
export function formatSchemaMismatch(cmd: string, error: z.ZodError): string {
  const lines = [
    ...new Set(
      collect(error.issues, []).map(
        (leaf) => `  ${renderPath(leaf.path) || "(root)"}: ${leaf.message}`,
      ),
    ),
  ];
  const shown = lines.slice(0, MAX_LINES);
  const hidden = lines.length - shown.length;
  if (hidden > 0) shown.push(`  … and ${hidden} more`);
  return [`OMC response shape mismatch for ${cmd}:`, ...shown].join("\n");
}
