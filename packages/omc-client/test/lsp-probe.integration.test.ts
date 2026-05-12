/**
 * LSP-feasibility probe — does OMC's scripting surface have what a Modelica
 * Language Server would need?
 *
 * # What this is
 *
 * A targeted probe (sibling of `drift-probe.integration.test.ts`) that pokes
 * the live OMC instance to answer three questions before we commit to
 * building an LSP backend on top of `@modelica-wrapper/omc-client`:
 *
 *   1. **Positioned diagnostics**: does `getMessagesString()` or
 *      `getMessagesStringInternal()` exist on the connected OMC, and if so
 *      what shape do they return? If they hand back structured records with
 *      file/line/col, diagnostics become trivial; otherwise we have to parse
 *      `getErrorString()` text.
 *   2. **`getErrorString` text format**: lock down the bracketed
 *      `[file:line:col-line:col:flag]` prefix on real broken Modelica so the
 *      regex we ship is anchored to observed output, not assumed.
 *   3. **Position-aware semantic queries**: do `getClassInformation` and
 *      `getModelInstance` actually carry source provenance (file + line +
 *      column) on the connected OMC?
 *
 * The probe is purely informational — it always passes. Outcomes are dumped
 * to stdout so a human (or PR-comment generator) can read them.
 *
 * # How to run it
 *
 *     OMC_LSP_PROBE=1 pnpm --filter @modelica-wrapper/omc-client \
 *       vitest run test/lsp-probe.integration.test.ts \
 *       --reporter=verbose
 */

import { execSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import type { OmcCommand } from "../src/commands.js";

function shouldRun(): boolean {
  if (process.env.OMC_LSP_PROBE !== "1") return false;
  if (process.env.OMC_INTEGRATION === "0") return false;
  if (process.env.OMC_PATH && process.env.OMC_PATH.length > 0) return true;
  try {
    execSync(process.platform === "win32" ? "where omc" : "command -v omc", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const describeIf = shouldRun() ? describe : describe.skip;

type Verdict = "ok" | "empty" | "missing" | "error";

const verdictGlyph: Record<Verdict, string> = {
  ok: "✓",
  empty: "⌀",
  missing: "✗",
  error: "⚠",
};

function classify(raw: string, err: string): Verdict {
  if (err.includes("not found in scope")) return "missing";
  if (err.length > 0) return "error";
  if (raw.length === 0) return "empty";
  return "ok";
}

function truncate(s: string, n = 320): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Deliberately broken Modelica snippets that should each trigger one error class. */
const brokenSamples: { label: string; src: string }[] = [
  {
    label: "syntax: missing semicolon",
    src: `model MwProbeSyntax
  Real x = 1.0
  Real y = 2.0;
equation
  y = x;
end MwProbeSyntax;`,
  },
  {
    label: "name: undefined identifier",
    src: `model MwProbeUndef
  Real x;
equation
  x = nonexistent_symbol;
end MwProbeUndef;`,
  },
  {
    label: "type: incompatible types",
    src: `model MwProbeType
  Real x;
  Boolean b;
equation
  x = b;
end MwProbeType;`,
  },
  {
    label: "multiple: two syntax errors",
    src: `model MwProbeMulti
  Real x = 1.0
  Real y = 2.0
equation
  y = x;
end MwProbeMulti;`,
  },
];

describeIf("OMC LSP-feasibility probe", () => {
  it("dumps OMC's response surface for LSP-relevant calls", async () => {
    const client = await OmcClient.create({
      omcPath: process.env.OMC_PATH ?? "",
    });
    try {
      await client.call("loadModel(Modelica)" as OmcCommand);
      const omcVersion = (await client.call("getVersion()" as OmcCommand)).trim();

      // eslint-disable-next-line no-console
      console.log("\n=== OMC LSP-feasibility probe ===");
      // eslint-disable-next-line no-console
      console.log(`OMC: ${omcVersion}`);
      // eslint-disable-next-line no-console
      console.log(
        "Legend: ✓ ok · ⌀ empty · ✗ symbol-missing · ⚠ other-error\n",
      );

      // -------------------------------------------------------------------
      // Probe 1 — positioned-diagnostic endpoints
      //
      // If either `getMessagesString` or `getMessagesStringInternal` returns
      // a structured record list with file/line/col on the broken samples,
      // we wire the LSP diagnostics provider straight to it and skip the
      // regex parse of `getErrorString`.
      // -------------------------------------------------------------------
      // eslint-disable-next-line no-console
      console.log("--- Probe 1: positioned-diagnostic endpoints ---");

      // Prime the buffer by loading one broken sample, then ask both
      // candidate endpoints what they have to say about it.
      await client.getErrorString();
      await client.call(
        `loadString("${brokenSamples[0].src.replace(/\n/g, "\\n").replace(/"/g, '\\"')}", "mw-probe-syntax.mo")` as OmcCommand,
      );

      for (const cmd of [
        "getMessagesString()",
        "getMessagesStringInternal()",
      ] as const) {
        await client.getErrorString();
        const raw = (await client.call(cmd as OmcCommand)).trim();
        const { errorString: err } = await client.getErrorString();
        const verdict = classify(raw, err);
        // eslint-disable-next-line no-console
        console.log(`${verdictGlyph[verdict]} [${verdict}] ${cmd}`);
        // eslint-disable-next-line no-console
        console.log(`  raw: ${raw.length === 0 ? "(empty)" : truncate(raw)}`);
        // eslint-disable-next-line no-console
        console.log(`  err: ${err.length === 0 ? "(none)" : truncate(err)}`);
        // eslint-disable-next-line no-console
        console.log("");
      }

      // -------------------------------------------------------------------
      // Probe 2 — `getErrorString` text format on real broken Modelica
      //
      // Capture one error string per scenario so we can pin our LSP regex
      // against actual OMC output instead of guessing.
      // -------------------------------------------------------------------
      // eslint-disable-next-line no-console
      console.log("--- Probe 2: getErrorString format on broken Modelica ---");

      for (const sample of brokenSamples) {
        // Use a unique pseudo-filename per sample so we can spot whether
        // OMC echoes it back into the diagnostic.
        const filename = `mw-probe-${sample.label.replace(/[^a-z0-9]+/gi, "-")}.mo`;
        const escaped = sample.src
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n");
        await client.getErrorString();
        await client.call(
          `loadString("${escaped}", "${filename}")` as OmcCommand,
        );
        const { errorString: err } = await client.getErrorString();
        // eslint-disable-next-line no-console
        console.log(`• ${sample.label}  (filename=${filename})`);
        // eslint-disable-next-line no-console
        console.log(`  err: ${err.length === 0 ? "(none)" : truncate(err, 640)}`);
        // eslint-disable-next-line no-console
        console.log("");
      }

      // -------------------------------------------------------------------
      // Probe 3 — position-aware semantic queries
      //
      // Confirm what source provenance OMC gives us for a known class and
      // for a getModelInstance response. These power go-to-definition.
      // -------------------------------------------------------------------
      // eslint-disable-next-line no-console
      console.log("--- Probe 3: position-aware semantic queries ---");

      const semProbes: { label: string; cmd: OmcCommand }[] = [
        {
          label: "getClassInformation(Modelica.Blocks.Math.Gain)",
          cmd: "getClassInformation(Modelica.Blocks.Math.Gain)" as OmcCommand,
        },
        {
          label: "getSourceFile(Modelica.Blocks.Math.Gain)",
          cmd: "getSourceFile(Modelica.Blocks.Math.Gain)" as OmcCommand,
        },
        {
          label: "getCrefInfo(Modelica.Blocks.Math.Gain.k)",
          cmd: "getCrefInfo(Modelica.Blocks.Math.Gain.k)" as OmcCommand,
        },
        {
          label: "getElementSourceFile(Modelica.Blocks.Math.Gain.k)",
          cmd: "getElementSourceFile(Modelica.Blocks.Math.Gain.k)" as OmcCommand,
        },
        {
          label: "parseString(\"model M end M;\", \"mw-parsestring.mo\")",
          cmd: 'parseString("model M end M;", "mw-parsestring.mo")' as OmcCommand,
        },
      ];

      for (const p of semProbes) {
        await client.getErrorString();
        const raw = (await client.call(p.cmd)).trim();
        const { errorString: err } = await client.getErrorString();
        const verdict = classify(raw, err);
        // eslint-disable-next-line no-console
        console.log(`${verdictGlyph[verdict]} [${verdict}] ${p.label}`);
        // eslint-disable-next-line no-console
        console.log(`  raw: ${raw.length === 0 ? "(empty)" : truncate(raw)}`);
        // eslint-disable-next-line no-console
        console.log(`  err: ${err.length === 0 ? "(none)" : truncate(err)}`);
        // eslint-disable-next-line no-console
        console.log("");
      }

      // getModelInstance is large; only peek at the source-provenance keys.
      await client.getErrorString();
      const miRaw = (
        await client.call(
          "getModelInstance(Modelica.Blocks.Math.Gain)" as OmcCommand,
        )
      ).trim();
      const { errorString: miErr } = await client.getErrorString();
      // eslint-disable-next-line no-console
      console.log(
        `${verdictGlyph[classify(miRaw, miErr)]} getModelInstance(Modelica.Blocks.Math.Gain) — size=${miRaw.length} bytes`,
      );
      const hasSourceField = /\"source\"\s*:/.test(miRaw);
      const sampleSource = miRaw.match(/\"source\"\s*:\s*\{[^}]{0,200}\}/);
      // eslint-disable-next-line no-console
      console.log(`  has "source" field: ${hasSourceField}`);
      // eslint-disable-next-line no-console
      console.log(
        `  sample: ${sampleSource ? truncate(sampleSource[0], 320) : "(no source field found)"}`,
      );
    } finally {
      for (const cls of [
        "MwProbeSyntax",
        "MwProbeUndef",
        "MwProbeType",
        "MwProbeMulti",
        "M",
      ]) {
        await client.call(`deleteClass(${cls})` as OmcCommand).catch(() => {});
      }
      await client.close();
    }
    expect(true).toBe(true);
  });
});
