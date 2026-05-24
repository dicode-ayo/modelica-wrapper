/**
 * LSP-feasibility probe — does OMC's scripting surface have what a Modelica
 * Language Server would need?
 *
 * # What this is
 *
 * A targeted probe (sibling of `drift-probe.integration.test.ts`) that pokes
 * the live OMC instance to answer three questions before we commit to
 * building an LSP backend on top of `@dicode/omc-client`:
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
 *     OMC_LSP_PROBE=1 pnpm --filter @dicode/omc-client \
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
      //
      // IMPORTANT: do NOT call getErrorString before the candidate
      // endpoint — getErrorString drains the diagnostic buffer.
      // -------------------------------------------------------------------
      // eslint-disable-next-line no-console
      console.log("--- Probe 1: positioned-diagnostic endpoints ---");

      for (const cmd of [
        "getMessagesString()",
        "getMessagesStringInternal()",
      ] as const) {
        // Drain, then trigger a fresh syntax error, THEN ask the endpoint.
        // (Triggering via loadString — a syntax error will populate the
        // buffer without draining it.)
        await client.getErrorString();
        const escaped = brokenSamples[0].src
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n");
        await client.call(
          `loadString("${escaped}", "mw-probe-syntax.mo")` as OmcCommand,
        );
        const raw = (await client.call(cmd as OmcCommand)).trim();
        // After the candidate call, see what's left in getErrorString.
        const { errorString: err } = await client.getErrorString();
        const verdict = classify(raw, err);
        // eslint-disable-next-line no-console
        console.log(`${verdictGlyph[verdict]} [${verdict}] ${cmd}`);
        // eslint-disable-next-line no-console
        console.log(`  raw: ${raw.length === 0 ? "(empty)" : truncate(raw, 640)}`);
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
        const className = `MwProbe${sample.label.replace(/[^a-z0-9]+/gi, "")}`;
        const escaped = sample.src
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n");

        // Step 1: loadString — surfaces syntax errors.
        await client.getErrorString();
        await client.call(
          `loadString("${escaped}", "${filename}")` as OmcCommand,
        );
        const { errorString: loadErr } = await client.getErrorString();

        // Step 2: checkModel — surfaces semantic errors (undefined name,
        // type mismatch). Only run if load succeeded enough to register
        // the class (i.e. for the name/type samples).
        let checkErr = "";
        if (loadErr.length === 0) {
          await client.call(`checkModel(${className})` as OmcCommand);
          checkErr = (await client.getErrorString()).errorString;
        }

        // eslint-disable-next-line no-console
        console.log(`• ${sample.label}  (filename=${filename}, class=${className})`);
        // eslint-disable-next-line no-console
        console.log(
          `  loadString err: ${loadErr.length === 0 ? "(none)" : truncate(loadErr, 640)}`,
        );
        // eslint-disable-next-line no-console
        console.log(
          `  checkModel err: ${checkErr.length === 0 ? (loadErr.length === 0 ? "(none)" : "(skipped — load failed)") : truncate(checkErr, 640)}`,
        );
        // eslint-disable-next-line no-console
        console.log("");
      }

      // -------------------------------------------------------------------
      // Probe 2b — URI-filename roundtrip
      //
      // Hand `loadString` a `modelica-source:/X.mo` URI as the pseudo-
      // filename and inspect what comes back via
      // `getMessagesStringInternal().messages[0].info.filename`. The
      // extension passes a URI string when the user is editing a virtual
      // `modelica-source:` document and expects to be able to look it up
      // again on the diagnostic so squiggles render in the editor.
      //
      // Two outcomes:
      //   (A) OMC echoes the URI verbatim → exact-match resolver works.
      //   (B) OMC strips/transforms (e.g. takes last path segment, treats
      //       `:` as a delimiter, URL-encodes the colon) → we need a
      //       prefix-detect / reverse-map strategy in the resolver.
      // -------------------------------------------------------------------
      // eslint-disable-next-line no-console
      console.log("--- Probe 2b: modelica-source: URI filename roundtrip ---");
      {
        const uriFilename = "modelica-source:/MwUriProbe.mo";
        const src = brokenSamples[0].src
          .replace(/MwProbeSyntax/g, "MwUriProbe");
        const escaped = src
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n");

        // Drain stale diagnostics, then trigger a fresh syntax error, then
        // read getMessagesStringInternal FIRST (it preserves the buffer);
        // getErrorString last because it drains.
        await client.getErrorString();
        await client.call(
          `loadString("${escaped}", "${uriFilename}")` as OmcCommand,
        );

        let echoedFilename = "(no messages)";
        try {
          const { messages } = await client.getMessagesStringInternal();
          if (messages.length > 0) {
            echoedFilename = messages[0].info.filename;
          }
        } catch (err) {
          echoedFilename = `(getMessagesStringInternal threw: ${(err as Error).message})`;
        }
        const { errorString: loadErr } = await client.getErrorString();

        const verbatim = echoedFilename === uriFilename;
        // eslint-disable-next-line no-console
        console.log(`• input  filename: ${uriFilename}`);
        // eslint-disable-next-line no-console
        console.log(`• echoed filename: ${echoedFilename}`);
        // eslint-disable-next-line no-console
        console.log(
          `• verbatim roundtrip: ${verbatim ? "YES — scenario (A)" : "NO  — scenario (B), extension needs prefix-detect resolver"}`,
        );
        // eslint-disable-next-line no-console
        console.log(
          `  loadString err: ${loadErr.length === 0 ? "(none)" : truncate(loadErr, 320)}`,
        );
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

      // getModelInstance is large; inspect what source-provenance keys
      // actually appear on the response.
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

      // Search the raw JSON for any key that smells like source provenance.
      const provenanceKeys = [
        "source",
        "info",
        "sourceInfo",
        "fileName",
        "lineNumberStart",
        "lineNumberEnd",
        "columnNumberStart",
        "columnNumberEnd",
        "file",
      ];
      for (const key of provenanceKeys) {
        const re = new RegExp(`\\"${key}\\"\\s*:`);
        const hit = re.test(miRaw);
        if (!hit) continue;
        const sample = miRaw.match(
          new RegExp(`\\"${key}\\"\\s*:\\s*(?:\\{[^}]{0,200}\\}|"[^"]{0,200}"|\\d+)`),
        );
        // eslint-disable-next-line no-console
        console.log(
          `  has "${key}": yes  sample: ${sample ? truncate(sample[0], 200) : "(?)"}`,
        );
      }
      const hasAnyProvenance = provenanceKeys.some((k) =>
        new RegExp(`\\"${k}\\"\\s*:`).test(miRaw),
      );
      if (!hasAnyProvenance) {
        // eslint-disable-next-line no-console
        console.log("  no provenance keys found — top-level slice follows:");
        // eslint-disable-next-line no-console
        console.log(`  ${truncate(miRaw, 400)}`);
      }
    } finally {
      for (const cls of [
        "MwProbeSyntax",
        "MwProbeUndef",
        "MwProbeType",
        "MwProbeMulti",
        "MwUriProbe",
        "M",
      ]) {
        await client.call(`deleteClass(${cls})` as OmcCommand).catch(() => {});
      }
      await client.close();
    }
    expect(true).toBe(true);
  });
});
