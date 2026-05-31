#!/usr/bin/env node
/**
 * Drift-detection for the vendored OpenModelica JSON Schemas under `_schemas/`.
 *
 * Fetches the upstream canonical files, strips our `_vendored` provenance
 * block from the local copies, and structurally compares them. Exits 0 when
 * the schemas are equivalent and 1 when they have drifted (so it can be wired
 * into a CI cron without further glue).
 *
 * Run via: `pnpm --filter @dicode/omc-client check-modelinstance-schema-drift`
 *
 * On drift: re-vendor the upstream files into `_schemas/`, replay the four
 * known typo patches (see `_schemas/README.md`), then cross-check our hand-
 * rolled `src/_shared/modelInstance.ts` for new fields or polymorphic shapes.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import $RefParser from "@apidevtools/json-schema-ref-parser";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = resolve(HERE, "..", "_schemas");

const SOURCES = [
  {
    file: "getModelInstance.schema.json",
    upstream:
      "https://raw.githubusercontent.com/OpenModelica/OpenModelica/master/doc/instanceAPI/getModelInstance.schema.json",
  },
  {
    file: "expression.schema.json",
    upstream:
      "https://raw.githubusercontent.com/OpenModelica/OpenModelica/master/doc/instanceAPI/expression.schema.json",
  },
];

async function main() {
  let drifted = false;

  for (const { file, upstream } of SOURCES) {
    const localPath = resolve(SCHEMAS_DIR, file);
    const localRaw = JSON.parse(readFileSync(localPath, "utf8"));
    delete localRaw._vendored; // strip our provenance block

    const upstreamRaw = await fetchJson(upstream);

    // Compare structurally. Stable-stringify by sorting keys.
    const localCanonical = stableStringify(localRaw);
    const upstreamCanonical = stableStringify(upstreamRaw);

    if (localCanonical === upstreamCanonical) {
      console.log(`✓ ${file}: in sync with upstream`);
    } else {
      drifted = true;
      console.error(`✗ ${file}: DRIFT detected vs ${upstream}`);
      const diff = firstFewDiffs(localRaw, upstreamRaw, file);
      for (const line of diff) console.error(`  ${line}`);
    }
  }

  // Sanity-check that the local schema is parseable (catches unfixed typos).
  try {
    await $RefParser.bundle(
      resolve(SCHEMAS_DIR, "getModelInstance.schema.json"),
      {
        resolve: {
          file: {
            canRead: true,
            read(f) {
              return readFileSync(f.url, "utf8");
            },
          },
        },
      },
    );
    console.log("✓ vendored schema bundles cleanly");
  } catch (err) {
    drifted = true;
    console.error("✗ vendored schema fails to bundle:", err.message);
  }

  if (drifted) {
    console.error(
      "\nDrift detected. Re-vendor `_schemas/*.json`, replay typo patches " +
        "(see `_schemas/README.md`), and cross-check `src/_shared/modelInstance.ts`.",
    );
    process.exit(1);
  }
}

/**
 * Pattern-based patches we apply to upstream schema text so it can be JSON-
 * parsed for structural comparison. These mirror the typo fixes recorded in
 * `_schemas/README.md`. If upstream eventually fixes them, the patches become
 * no-ops and the comparison still works.
 */
const UPSTREAM_TEXT_PATCHES = [
  // Line 167, 238, 405: `"type": "#/definitions/X"` should be `"$ref": ...`.
  // Pattern is unambiguous: `"type": "#/definitions/`.
  [/"type": "#\/definitions\//g, '"$ref": "#/definitions/'],
  // Line 462: missing comma after the `$type` property block.
  [
    /"description": "The fully qualified type name of a redeclare element in a choices annotation"\s*\}\s*\n(\s*)"final"/,
    '"description": "The fully qualified type name of a redeclare element in a choices annotation"\n            },\n$1"final"',
  ],
];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url}: HTTP ${res.status}`);
  }
  let text = await res.text();
  for (const [pattern, replacement] of UPSTREAM_TEXT_PATCHES) {
    text = text.replace(pattern, replacement);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `failed to parse upstream JSON at ${url} after applying known patches: ${err.message}`,
    );
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]))
      .join(",") +
    "}"
  );
}

/**
 * Returns up to 5 lines describing where local and upstream diverge — top-level
 * key adds/removes plus first deep mismatch. Cheap human signal; not a full diff.
 */
function firstFewDiffs(local, upstream, label, depth = 0, lines = []) {
  if (lines.length >= 5) return lines;
  if (typeof local !== typeof upstream) {
    lines.push(`type changed at root: ${typeof local} → ${typeof upstream}`);
    return lines;
  }
  if (local === null || typeof local !== "object") {
    if (local !== upstream) {
      lines.push(
        `value changed: ${JSON.stringify(local)} → ${JSON.stringify(upstream)}`,
      );
    }
    return lines;
  }
  if (Array.isArray(local) || Array.isArray(upstream)) {
    if (JSON.stringify(local) !== JSON.stringify(upstream)) {
      lines.push(`array changed at depth ${depth}`);
    }
    return lines;
  }
  const localKeys = new Set(Object.keys(local));
  const upstreamKeys = new Set(Object.keys(upstream));
  for (const k of upstreamKeys) {
    if (!localKeys.has(k)) lines.push(`upstream added key: ${label}.${k}`);
    if (lines.length >= 5) return lines;
  }
  for (const k of localKeys) {
    if (!upstreamKeys.has(k)) lines.push(`upstream removed key: ${label}.${k}`);
    if (lines.length >= 5) return lines;
  }
  for (const k of localKeys) {
    if (!upstreamKeys.has(k)) continue;
    if (lines.length >= 5) return lines;
    firstFewDiffs(local[k], upstream[k], `${label}.${k}`, depth + 1, lines);
  }
  return lines;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
