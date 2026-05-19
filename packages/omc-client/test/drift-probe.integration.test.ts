/**
 * Drift probe — ground-truth check for the ⛔ functions in `coverage.md`.
 *
 * # What this is
 *
 * A targeted, *informational* test that pokes the connected OMC instance
 * directly through `OmcClient.call()` (bypassing our typed wrappers) for each
 * function we currently flag as broken / missing / signature-shifted. For each
 * call it prints:
 *
 *   - the literal command string sent to OMC
 *   - OMC's raw response (or `(empty)` if blank)
 *   - the contents of `getErrorString()` afterwards
 *   - a one-letter classification (✓ ok, ⌀ empty, ✗ symbol-missing, ⚠ other err)
 *
 * The probe is what lets us tell, after an OMC version bump, which currently-
 * deprecated wrappers might now work and which ones still don't — without
 * relying on (sometimes-stale) docs.
 *
 * # Why it's gated
 *
 * On the regular CI integration run (`OMC_INTEGRATION=1`) we don't want this
 * stdout dump cluttering the test output. The probe gates on its own env
 * variable and is skipped otherwise. Set `OMC_DRIFT_PROBE=1` to opt in.
 *
 * # When to run it
 *
 *   - **Locally** when investigating drift, after upgrading OMC, or when
 *     adding a new ⛔ entry to `coverage.md` that needs ground truth.
 *   - **In CI** automatically by `.github/workflows/omc-update-audit.yml`
 *     on PRs labeled `omc-update`. The workflow captures the probe's stdout
 *     and pastes it into the PR comment alongside the audit checklist —
 *     so the human reviewer sees concrete OMC behavior on the new version
 *     instead of guessing.
 *
 * # How to run it manually
 *
 *     OMC_DRIFT_PROBE=1 pnpm --filter @modelica-wrapper/omc-client \
 *       vitest run test/drift-probe.integration.test.ts \
 *       --reporter=verbose
 *
 * # How to extend it
 *
 *   1. Pick a function from the ⛔ table in `docs/coverage.md` (or one you
 *      suspect of drifting).
 *   2. Add a `Probe` entry to the array below with the exact OMC command
 *      string you want to test, plus an alternate-shape variant if
 *      relevant (the docs-correct shape, the shape some older OMC accepted,
 *      etc.).
 *   3. Run the probe locally; if a previously-✗ call now returns ✓, drop
 *      the wrapper's `@deprecated` tag and add a real test for it.
 *
 * The probe is deliberately permissive about what it expects — its job is
 * to *report*, not to *enforce*. The PR review is where decisions land.
 */

import { execSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import type { OmcCommand } from "../src/commands.js";

/** Returns true if both `omc` is reachable and the user opted into the probe. */
function shouldRun(): boolean {
  if (process.env.OMC_DRIFT_PROBE !== "1") return false;
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

interface Probe {
  /** Short label printed alongside the result for human scanning. */
  label: string;
  /** Reference to the wrapper this probe vets. */
  wrapper: string;
  /** Optional context — alternate shapes, why this exists. */
  note?: string;
  /** The exact OMC command string we send. */
  cmd: OmcCommand;
}

/**
 * Suspect calls to probe. Keep in lock-step with the ⛔ rows in
 * `docs/coverage.md`: every wrapper marked ⛔ should appear here at least
 * once. Adding alternate-shape probes (e.g. quoted vs bare destinations)
 * is encouraged when the docs and OMC source disagree.
 */
const probes: Probe[] = [
  // ----- Lifecycle (createClass, createSubClass, moveClass*) -----
  {
    label: "createClass(bare)",
    wrapper: "lifecycle/createClass.ts",
    note: "Undocumented in 1.26 public scripting API. Migration on 1.26.x: loadString.",
    cmd: 'createClass(MwProbeCreate, "model", false, false)' as OmcCommand,
  },
  {
    label: "createSubClass(bare)",
    wrapper: "lifecycle/createSubClass.ts",
    note: "Same status as createClass.",
    cmd: 'createSubClass(MwProbeSub, MwProbeCreate, "model", false, false)' as OmcCommand,
  },
  {
    label: "moveClass(docs-correct Integer-offset shape)",
    wrapper: "lifecycle/moveClass.ts",
    note: "Regression watch: this is the in-place reorder by Integer offset (NOT cross-package relocate). Earlier wrapper sent a TypeName here and OMC returned a misleading 'not found in scope' diagnostic; see audit.md §2.10.",
    cmd: "moveClass(Modelica.Blocks.Math.Sin, 1)" as OmcCommand,
  },
  {
    label: "moveClassToTop(bare)",
    wrapper: "lifecycle/moveClassToTop.ts",
    cmd: "moveClassToTop(Modelica.Blocks.Math.Sin)" as OmcCommand,
  },
  {
    label: "moveClassToBottom(bare)",
    wrapper: "lifecycle/moveClassToBottom.ts",
    cmd: "moveClassToBottom(Modelica.Blocks.Math.Sin)" as OmcCommand,
  },

  // ----- Lifecycle: copyClass — currently ✅, kept here as a regression watch -----
  {
    label: "copyClass(bare TypeName destination — should fail)",
    wrapper: "lifecycle/copyClass.ts",
    note: "Counter-example: docs say `String newClassName`. If this returns true on a future OMC, the wrapper might be over-quoting.",
    cmd: "copyClass(Modelica.Blocks.Math.Sin, MwProbeCopy)" as OmcCommand,
  },
  {
    label: "copyClass(quoted-String destination per docs — should pass)",
    wrapper: "lifecycle/copyClass.ts",
    cmd: 'copyClass(Modelica.Blocks.Math.Sin, "MwProbeCopy")' as OmcCommand,
  },

  // ----- Editing: updateConnection — currently ✅ after arg-order fix, kept as regression watch -----
  {
    label: "updateConnection(docs-correct shape)",
    wrapper: "editing/updateConnection.ts",
    note: "Regression watch: arg order is (className, String from, String to, annotate). Earlier wrapper had from/to before className and OMC returned a misleading 'not found in scope' diagnostic; see audit.md §2.10.",
    cmd: 'updateConnection(Modelica.Blocks.Examples.PID_Controller, "spring.flange_b", "inertia2.flange_a", Line())' as OmcCommand,
  },

  // ----- Editing: setComponentProperties — currently ✅, kept as a regression watch -----
  {
    label: "setComponentProperties(docs-correct 6-arg shape)",
    wrapper: "editing/setComponentProperties.ts",
    note: "If this regresses to ✗, OMC may have moved back to the old 4-element prefix shape.",
    cmd: 'setComponentProperties(Modelica.Blocks.Examples.PID_Controller, PI, {false,false,false,false,false}, {""}, {false,false}, {""})' as OmcCommand,
  },

  // ----- Parameters: removeComponentModifiers — currently ✅ after String-quoting fix -----
  {
    label: "removeComponentModifiers(docs-correct quoted componentName)",
    wrapper: "parameters/removeComponentModifiers.ts",
    note: "Regression watch: componentName is `String`, must be quoted. Earlier wrapper sent it bare and OMC returned a misleading 'not found in scope' diagnostic; see audit.md §2.10.",
    cmd: 'removeComponentModifiers(Modelica.Blocks.Examples.PID_Controller, "PI", false)' as OmcCommand,
  },

  // ----- Counter-examples: the bare-ident shapes that used to ship -----
  // Keep these so the OMC error pattern stays documented. If a future
  // OMC version starts accepting bare idents here too, drop these probes.
  {
    label: "removeComponentModifiers(bare ident — the OLD broken shape)",
    wrapper: "parameters/removeComponentModifiers.ts",
    note: "Counter-example: should ✗ because componentName is String-typed, not a TypeName.",
    cmd: "removeComponentModifiers(Modelica.Blocks.Examples.PID_Controller, PI, false)" as OmcCommand,
  },
];

/**
 * Symptom classification. The full set is intentionally small so the audit
 * can grep for outcomes at a glance.
 */
type Verdict = "ok" | "empty" | "missing" | "error";

function classify(raw: string, err: string): Verdict {
  if (err.includes("not found in scope")) return "missing";
  if (err.length > 0) return "error";
  if (raw.length === 0) return "empty";
  return "ok";
}

const verdictGlyph: Record<Verdict, string> = {
  ok: "✓",
  empty: "⌀",
  missing: "✗",
  error: "⚠",
};

describeIf("OMC drift probe", () => {
  it("dumps OMC's actual response for each suspect call", async () => {
    const client = await OmcClient.create({
      omcPath: process.env.OMC_PATH ?? "",
    });
    try {
      // Load Modelica so probes that touch it have something to look at.
      await client.call("loadModel(Modelica)");

      const omcVersion = (await client.call("getVersion()")).trim();

      // eslint-disable-next-line no-console
      console.log("\n=== OMC drift probe ===");
      // eslint-disable-next-line no-console
      console.log(`OMC: ${omcVersion}`);
      // eslint-disable-next-line no-console
      console.log(
        `Probes: ${probes.length}   (legend: ✓ ok · ⌀ empty · ✗ symbol-missing · ⚠ other-error)\n`,
      );

      const summary: { verdict: Verdict; label: string }[] = [];

      for (const p of probes) {
        // Drain OMC's error buffer first so the err we read after the probe
        // call is unambiguously about THIS probe.
        await client.getErrorString();

        const raw = (await client.call(p.cmd)).trim();
        // Use the typed wrapper so the surrounding quotes from OMC's
        // String-typed response are stripped before classification.
        const { errorString: err } = await client.getErrorString();
        const verdict = classify(raw, err);
        summary.push({ verdict, label: p.label });

        const glyph = verdictGlyph[verdict];
        // eslint-disable-next-line no-console
        console.log(`${glyph} [${verdict}] ${p.label}`);
        // eslint-disable-next-line no-console
        console.log(`  wrapper: ${p.wrapper}`);
        if (p.note) {
          // eslint-disable-next-line no-console
          console.log(`  note: ${p.note}`);
        }
        // eslint-disable-next-line no-console
        console.log(`  cmd: ${p.cmd}`);
        const truncate = (s: string): string =>
          s.length > 240 ? `${s.slice(0, 240)}…` : s;
        // eslint-disable-next-line no-console
        console.log(`  raw: ${raw.length === 0 ? "(empty)" : truncate(raw)}`);
        // eslint-disable-next-line no-console
        console.log(`  err: ${err.length === 0 ? "(none)" : truncate(err)}`);
        // eslint-disable-next-line no-console
        console.log("");
      }

      // Final summary so the PR-comment generator can grab a clean tally.
      // eslint-disable-next-line no-console
      console.log("=== summary ===");
      for (const s of summary) {
        // eslint-disable-next-line no-console
        console.log(`${verdictGlyph[s.verdict]} ${s.verdict.padEnd(8)} ${s.label}`);
      }
    } finally {
      // Best-effort cleanup of any classes the probe created above.
      for (const cls of ["MwProbeCreate", "MwProbeSub", "MwProbeCopy"]) {
        await client.call(`deleteClass(${cls})`).catch(() => {});
      }
      await client.close();
    }
    // The probe always passes — its job is to *report*, not enforce.
    expect(true).toBe(true);
  });
});
