/**
 * The captured `getModelInstance` output for
 * `Modelica.Blocks.Examples.PID_Controller`, run through the same producer
 * the VSCode extension uses:
 *
 *   pidController.modelInstance.json  (real OMC capture, 1.3 MB)
 *     → diagram.produceDiagramLayout(mi, 'diagram')   (typed layout)
 *
 * The heaviest fixture in the suite — every layer (icon provider + texture
 * cache, component placement, nested connectors via class.connectors
 * PortDef, multi-segment connection waypoints, stroke routing) is
 * exercised against real Modelica data. Shared so the stories that render
 * it pay for the JSON and the producer once between them.
 */

// Deep subpath import: pulls only the pure producer (and its shape /
// placement helpers). Importing from the package root would bring in
// `OmcClient` + `spawnOmc` which depend on `zeromq` / `node:fs` and
// can't bundle for the browser.
import { produceDiagramLayout } from "@dicode/omc-client/api/diagram/index.js";
import type { DiagramLayout, ModelInstance } from "@dicode/omc-client";

import pidFixture from "./pidController.modelInstance.json";

// The fixture was captured against a real OMC and is known-valid (the
// producer's own test suite validates it on every push). We skip
// ModelInstanceSchema.parse here to keep the story bundle browser-only —
// the schema module itself is browser-safe, but re-exporting it from the
// omc-client barrel forces the OmcClient class import too.
export const pidLayout: DiagramLayout = produceDiagramLayout(
  pidFixture as unknown as ModelInstance,
  "diagram",
);
