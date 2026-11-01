/**
 * Export the diagrams of a library's example models as data: for each
 * example, OMC's raw `getModelInstance` tree and the `DiagramLayout` the UI
 * renders from it, plus a summary that flags connections the layout dropped.
 *
 *     esbuild scripts/export-diagrams.ts --bundle --platform=node --format=esm \
 *       --packages=external --outfile=node_modules/.cache/export-diagrams.mjs
 *     node node_modules/.cache/export-diagrams.mjs --out <dir> <class>...
 *
 * Each `<class>` is expanded recursively to the classes inside it that extend
 * `Modelica.Icons.Example`. Needs `omc` on PATH and the Modelica library.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { diagram, OmcClient } from "../src/index.js";

interface ExampleSummary {
  className: string;
  components: number;
  connectionsDeclared: number;
  connectionsInLayout: number;
  error?: string;
}

const { values, positionals } = parseArgs({
  options: { out: { type: "string" } },
  allowPositionals: true,
});
const out = values.out;
if (out === undefined || positionals.length === 0) {
  console.error("usage: export-diagrams --out <dir> <class>...");
  process.exit(2);
}

const client = await OmcClient.create({ callTimeoutMs: 300_000 });
try {
  const { success } = await client.loadModel({ typeName: "Modelica" });
  if (!success) {
    throw new Error("loadModel(Modelica) failed: is the library installed?");
  }
  await mkdir(out, { recursive: true });

  const examples: string[] = [];
  for (const root of positionals) {
    const { classNames } = await client.getClassNames({
      typeName: root,
      recursive: true,
      qualified: true,
    });
    for (const className of [root, ...classNames]) {
      const { res } = await client.extendsFrom({
        typeName: className,
        baseClassName: "Modelica.Icons.Example",
      });
      if (res) {
        examples.push(className);
      }
    }
  }

  const summary: ExampleSummary[] = [];
  for (const className of examples) {
    try {
      const { instance } = await client.getModelInstance({
        typeName: className,
      });
      const layout = diagram.produceDiagramLayout(instance, "diagram");
      const { count } = await client.getConnectionCount({
        typeName: className,
      });
      await writeFile(
        join(out, `${className}.modelInstance.json`),
        JSON.stringify(instance) + "\n",
      );
      await writeFile(
        join(out, `${className}.diagram.json`),
        JSON.stringify(layout, null, 2) + "\n",
      );
      summary.push({
        className,
        components: Object.keys(layout.components).length,
        connectionsDeclared: count,
        connectionsInLayout: layout.connections.length,
      });
    } catch (err) {
      summary.push({
        className,
        components: 0,
        connectionsDeclared: 0,
        connectionsInLayout: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const last = summary.at(-1);
    console.log(
      last?.error === undefined
        ? `${className}: ${last?.components} components, ${last?.connectionsInLayout}/${last?.connectionsDeclared} connections`
        : `${className}: FAILED ${last.error}`,
    );
  }
  await writeFile(
    join(out, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
} finally {
  await client.close();
}
