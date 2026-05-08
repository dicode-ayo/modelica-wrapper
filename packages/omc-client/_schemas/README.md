# OpenModelica canonical JSON Schemas (vendored)

Source of truth for OMC's `getModelInstance` AST shape. Vendored verbatim from
`OpenModelica/OpenModelica` plus a small set of typo patches needed to make the
files parseable as JSON.

| File | Upstream |
|---|---|
| `getModelInstance.schema.json` | <https://raw.githubusercontent.com/OpenModelica/OpenModelica/master/doc/instanceAPI/getModelInstance.schema.json> |
| `expression.schema.json` | <https://raw.githubusercontent.com/OpenModelica/OpenModelica/master/doc/instanceAPI/expression.schema.json> |

Provenance — upstream commit hash, vendor date, license note, and the
line-by-line list of typo patches applied vs upstream — lives inline in each
schema's `_vendored` block.

## License

Both files are dual-licensed under OSMC-PL 1.8 / GPL-3.0 in the upstream repo.
We treat the schemas as **interface descriptions** (analogous to OpenAPI specs)
rather than as software: the structural facts they encode are what we use to
hand-roll our Zod in `src/_shared/modelInstance.ts`. The Zod we ship is our
own derived code; this directory exists for provenance and to drive
drift detection.

## Drift detection

```sh
pnpm --filter @modelica-wrapper/omc-client check-modelinstance-schema-drift
```

Fetches both upstream files, applies the same typo patches, and structurally
compares to our vendored copies (after stripping the `_vendored` block).
Exit 0 → in sync; exit 1 → upstream has bumped, re-vendor and cross-check
`src/_shared/modelInstance.ts`.

## Re-vendoring procedure

1. Download the latest upstream files into this directory, overwriting the
   existing copies.
2. Re-add the `_vendored` block to the top of each file (commit hash + date +
   the per-line typo patch list — keep entries that still apply, drop ones
   upstream has fixed).
3. Verify the schema is parseable: `node -e "require('fs').readFileSync('_schemas/getModelInstance.schema.json'); JSON.parse(require('fs').readFileSync('_schemas/getModelInstance.schema.json', 'utf8'))"`.
4. Re-run `pnpm check-modelinstance-schema-drift` to confirm equivalence.
5. Cross-check `src/_shared/modelInstance.ts` for new fields, polymorphic
   shapes, or `$kind` variants the canonical now lists; patch the hand-rolled
   schema as needed.
6. Run `pnpm -r typecheck` and `pnpm -r test` against real OMC.
