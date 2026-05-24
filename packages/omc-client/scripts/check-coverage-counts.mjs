#!/usr/bin/env node
/**
 * Drift-detection between `docs/coverage.md` and the actual filesystem.
 *
 * `coverage.md` carries two count surfaces that have to stay in lock-step
 * with the number of wrapper files in `src/api/<category>/`:
 *
 *   1. Per-category section headers — e.g. `## Browsing — 28/28`
 *      (the right-hand number is the wrapper total for that category).
 *   2. The "Summary by category" table near the bottom.
 *
 * Manual recounting drifts. This script does it for you:
 *
 *   - For each category in `CATEGORIES`, count the wrapper files in
 *     `src/api/<category>/` (excluding `index.ts` and co-located
 *     `*.test.ts` files).
 *   - Parse the matching section header + summary-table row from
 *     `coverage.md`.
 *   - Compare totals. Exit 0 on a clean match; exit 1 with a per-category
 *     diff on drift.
 *
 * Coverage-status counts (✅ / 🟡 / ⛔ / 🐢) are *not* checked here — they
 * encode integration-test verdicts that only a human knows. Only the
 * **wrapper total** (right-hand number of `N/M`) is verified.
 *
 * Run via: `pnpm --filter @dicode/omc-client coverage:recount`
 *
 * On drift: refresh `coverage.md` headers + summary table, or add/remove
 * wrappers, until both surfaces agree.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const API_DIR = resolve(PKG_ROOT, "src", "api");
const COVERAGE_MD = resolve(PKG_ROOT, "docs", "coverage.md");

/**
 * Each entry maps a `src/api/<dir>/` directory name to the headings used in
 * `coverage.md`. `header` matches the `## <name> — N/M` section heading;
 * `summaryRow` matches the leading cell of the row in the Summary table.
 *
 * The `diagram/` directory under `src/api/` is intentionally excluded —
 * it holds helper modules (placement, walker, producer, …), not OMC
 * wrappers, and is not represented in `coverage.md`.
 */
const CATEGORIES = [
  { dir: "browsing", header: "Browsing", summaryRow: "Browsing" },
  {
    dir: "contents",
    header: "Reading model contents",
    summaryRow: "Reading model contents",
  },
  { dir: "lifecycle", header: "Lifecycle", summaryRow: "Lifecycle" },
  {
    dir: "parameters",
    header: "Parameters & modifiers",
    summaryRow: "Parameters & modifiers",
  },
  { dir: "editing", header: "Editing", summaryRow: "Editing" },
  {
    dir: "elements",
    header: "Elements \\(modern Component\\* generalization\\)",
    summaryRow: "Elements",
  },
  {
    dir: "library",
    header: "Library / package management",
    summaryRow: "Library",
  },
  {
    dir: "solver",
    header: "Solver / runtime config",
    summaryRow: "Solver / runtime config",
  },
  { dir: "execution", header: "Execution", summaryRow: "Execution" },
  { dir: "results", header: "Results", summaryRow: "Results" },
];

/**
 * Count wrapper `.ts` files in a category directory.
 *
 * Excludes:
 *   - `index.ts` (barrel)
 *   - `*.test.ts` (co-located unit tests; rare but happens — see
 *     `editing/addComponent.test.ts`)
 */
function countWrappers(dir) {
  const dirPath = resolve(API_DIR, dir);
  let count = 0;
  for (const name of readdirSync(dirPath)) {
    if (!name.endsWith(".ts")) continue;
    if (name === "index.ts") continue;
    if (name.endsWith(".test.ts")) continue;
    const full = resolve(dirPath, name);
    if (!statSync(full).isFile()) continue;
    count += 1;
  }
  return count;
}

/**
 * Parse `coverage.md` for the per-category wrapper totals.
 *
 * Returns a map keyed by category-dir name with `{ header, summary }`
 * entries — each holding the parsed total (or `undefined` when the entry
 * couldn't be located).
 */
function parseCoverageTotals(md) {
  const out = {};
  for (const cat of CATEGORIES) {
    // Section header line: `## Browsing — 28/28` (em-dash) or with trailing
    // free-form annotation like `## Reading model contents — 25/27`.
    const headerRe = new RegExp(
      String.raw`^##\s+${cat.header}\s+—\s+(\d+)\s*/\s*(\d+)`,
      "m",
    );
    const headerMatch = md.match(headerRe);

    // Summary-table row: `| Browsing | 28 | 28 | …`. The first capture is
    // covered, the second is total.
    const summaryRe = new RegExp(
      String.raw`^\|\s*${cat.summaryRow}\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|`,
      "m",
    );
    const summaryMatch = md.match(summaryRe);

    out[cat.dir] = {
      header: headerMatch ? Number(headerMatch[2]) : undefined,
      summary: summaryMatch ? Number(summaryMatch[2]) : undefined,
    };
  }
  return out;
}

/**
 * Parse the grand-total line from the Summary table:
 * `| **Total verified** | **135** | **150** |`. Returns
 * `{ verified, total }` (covered, total).
 */
function parseGrandTotal(md) {
  const m = md.match(
    /^\|\s*\*\*Total verified\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*/m,
  );
  if (!m) return undefined;
  return { verified: Number(m[1]), total: Number(m[2]) };
}

/**
 * Parse the headline-prose count from the "Current coverage" line:
 * `**Current coverage:** **207 wrappers in package; 195 ✅ verified …**`.
 *
 * This prose surface drifted past CI for ≥2 PRs because only the section
 * headers + summary table were checked (issue #76, item 18). Returns
 * `{ total, verified }` — the wrapper total and the ✅-verified count.
 */
function parseHeadline(md) {
  const m = md.match(
    /\*\*(\d+)\s+wrappers in package;\s*(\d+)\s*✅\s*verified/,
  );
  if (!m) return undefined;
  return { total: Number(m[1]), verified: Number(m[2]) };
}

function main() {
  const md = readFileSync(COVERAGE_MD, "utf8");
  const docTotals = parseCoverageTotals(md);
  const grand = parseGrandTotal(md);
  const docGrandTotal = grand?.total;
  const headline = parseHeadline(md);

  let drifted = false;
  let fsGrandTotal = 0;
  const rows = [];

  for (const cat of CATEGORIES) {
    const fsCount = countWrappers(cat.dir);
    fsGrandTotal += fsCount;
    const doc = docTotals[cat.dir];
    const headerOk = doc.header === fsCount;
    const summaryOk = doc.summary === fsCount;
    rows.push({
      dir: cat.dir,
      fs: fsCount,
      header: doc.header,
      summary: doc.summary,
      headerOk,
      summaryOk,
    });
    if (!headerOk || !summaryOk) drifted = true;
  }

  const grandTotalOk = docGrandTotal === fsGrandTotal;
  if (!grandTotalOk) drifted = true;

  // Headline prose (issue #76, item 18): its wrapper TOTAL must match the
  // filesystem, and its ✅-verified count must match the Summary table's
  // verified total — so the two prose surfaces can never silently diverge.
  const headlineTotalOk = headline?.total === fsGrandTotal;
  const headlineVerifiedOk =
    headline !== undefined &&
    grand !== undefined &&
    headline.verified === grand.verified;
  if (!headlineTotalOk || !headlineVerifiedOk) drifted = true;

  const fmt = (label, fs, doc, ok) =>
    `  ${ok ? "✓" : "✗"} ${label.padEnd(12)} fs=${String(fs).padStart(3)}  doc=${
      doc === undefined ? "(missing)" : String(doc).padStart(3)
    }`;

  console.log("Per-category wrapper totals (fs vs coverage.md):");
  console.log("");
  for (const r of rows) {
    console.log(fmt(`${r.dir} hdr`, r.fs, r.header, r.headerOk));
    console.log(fmt(`${r.dir} sum`, r.fs, r.summary, r.summaryOk));
  }
  console.log("");
  console.log(
    `  ${grandTotalOk ? "✓" : "✗"} grand total fs=${fsGrandTotal} doc=${
      docGrandTotal === undefined ? "(missing)" : docGrandTotal
    }`,
  );
  console.log(
    `  ${headlineTotalOk ? "✓" : "✗"} headline total fs=${fsGrandTotal} doc=${
      headline === undefined ? "(missing)" : headline.total
    }`,
  );
  console.log(
    `  ${headlineVerifiedOk ? "✓" : "✗"} headline ✅ verified summary=${
      grand === undefined ? "(missing)" : grand.verified
    } doc=${headline === undefined ? "(missing)" : headline.verified}`,
  );

  if (drifted) {
    console.error("");
    console.error(
      "Drift detected. Update `packages/omc-client/docs/coverage.md` — the per-category section headers (`## Name — N/M`), the Summary-by-category table, AND the headline `Current coverage` prose line — so all surfaces match the filesystem counts above.",
    );
    process.exit(1);
  }

  console.log("");
  console.log("coverage.md totals match filesystem counts.");
}

main();
