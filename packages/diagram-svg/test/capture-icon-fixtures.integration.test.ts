/**
 * One-shot icon-fixture capture against a live OMC.
 *
 * Reads `getModelInstance` from real OMC, runs the producer, and writes
 * the resulting `iconLayers` (per target class) to
 * `packages/diagram-svg/stories/fixtures/` as JSON. The Storybook stories
 * in `stories/RealIcons.stories.ts` import those JSONs at build time.
 *
 * Run with:
 *
 *     pnpm --filter @dicode/diagram-svg capture-icons
 *
 * Requires `omc` on PATH (or `OMC_PATH` env). Skipped by default
 * (`OMC_INTEGRATION=0`); the package script flips the gate to 1.
 *
 * Why a vitest test rather than a node script?
 * Vitest already understands the workspace's TypeScript module graph, so
 * we can import `OmcClient` + `produceDiagramLayout` directly without
 * adding a TS-loader devDep. The "it captures X" structure also gives a
 * clear pass/fail per target.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  OmcClient,
  diagram,
  type IconLayer,
  type CoordinateSystem,
  type ClassDef,
} from "@dicode/omc-client";

const RUN = process.env.OMC_INTEGRATION === "1";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "..", "stories", "fixtures");

/**
 * Targets captured from their own `getModelInstance` call. Each writes
 * `<slug>.icon.json` carrying `{ className, iconLayers, coordinateSystem }`.
 */
const HOST_TARGETS: Array<{ className: string; slug: string }> = [
  { className: "Modelica.Blocks.Math.Sin", slug: "sin" },
  { className: "Modelica.Blocks.Math.Gain", slug: "gain" },
  { className: "Modelica.Blocks.Math.Add", slug: "add" },
  { className: "Modelica.Blocks.Sources.Constant", slug: "constant" },
];

/**
 * Targets pulled out of `PID_Controller`'s produced layout.classes catalog.
 * Their iconLayers are populated by the producer's per-class walker, so we
 * get the full extends-chain stack of shapes for each — same data the
 * renderer would consume to draw them as sub-components on a parent diagram.
 */
const PID_CATALOG_TARGETS: Array<{ className: string; slug: string }> = [
  { className: "Modelica.Blocks.Continuous.LimPID", slug: "limpid" },
  {
    className: "Modelica.Mechanics.Rotational.Components.Inertia",
    slug: "inertia",
  },
  {
    className: "Modelica.Mechanics.Rotational.Components.SpringDamper",
    slug: "springdamper",
  },
  { className: "Modelica.Mechanics.Rotational.Sources.Torque", slug: "torque" },
];

interface IconFixture {
  className: string;
  iconLayers: IconLayer[];
  coordinateSystem: CoordinateSystem | undefined;
}

function classDefToFixture(cls: ClassDef): IconFixture {
  return {
    className: cls.name,
    iconLayers: cls.iconLayers,
    coordinateSystem: cls.coordinateSystem,
  };
}

async function writeFixture(slug: string, fixture: IconFixture): Promise<void> {
  await mkdir(FIXTURES_DIR, { recursive: true });
  const path = resolve(FIXTURES_DIR, `${slug}.icon.json`);
  await writeFile(path, JSON.stringify(fixture, null, 2) + "\n", "utf8");
}

describe.skipIf(!RUN)("capture icon fixtures (live OMC)", () => {
  let client: OmcClient;

  beforeAll(async () => {
    client = await OmcClient.create();
    const loaded = await client.loadModel({ typeName: "Modelica" });
    if (!loaded.success) {
      throw new Error(
        "loadModel(Modelica) returned success=false — is MSL installed?",
      );
    }
  });

  afterAll(async () => {
    await client?.close();
  });

  for (const { className, slug } of HOST_TARGETS) {
    it(`captures ${className}`, async () => {
      const { instance } = await client.getModelInstance({
        typeName: className,
      });
      const layout = diagram.produceDiagramLayout(instance, "icon");

      // Sanity-check that the host actually carries icon graphics. If a
      // future MSL release strips a class's icon, we want to surface that
      // here rather than write a blank fixture.
      const totalShapes = layout.iconLayers.reduce(
        (sum, l) => sum + l.shapes.length,
        0,
      );
      expect(totalShapes, `${className} has no icon shapes`).toBeGreaterThan(0);

      await writeFixture(slug, {
        className,
        iconLayers: layout.iconLayers,
        coordinateSystem: layout.coordinateSystem,
      });
    });
  }

  describe("PID_Controller catalog extraction", () => {
    let pidLayout: ReturnType<typeof diagram.produceDiagramLayout>;

    beforeAll(async () => {
      const { instance } = await client.getModelInstance({
        typeName: "Modelica.Blocks.Examples.PID_Controller",
      });
      pidLayout = diagram.produceDiagramLayout(instance, "icon");
    });

    for (const { className, slug } of PID_CATALOG_TARGETS) {
      it(`extracts ${className} from PID catalog`, async () => {
        const cls = pidLayout.classes[className];
        expect(cls, `${className} missing from PID catalog`).toBeDefined();
        const fixture = classDefToFixture(cls!);
        const totalShapes = fixture.iconLayers.reduce(
          (sum, l) => sum + l.shapes.length,
          0,
        );
        expect(totalShapes, `${className} has no icon shapes`).toBeGreaterThan(
          0,
        );
        await writeFixture(slug, fixture);
      });
    }
  });
});
