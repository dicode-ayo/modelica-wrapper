# diagram-snapshots — inspection dumps

Pretty-printed JSON dumps of `produceDiagramLayout(...)` output for the
fixtures in `../fixtures/`. Files in this directory are **regenerated on
every test run** by `src/api/diagram/producer.test.ts`; they are not
strict snapshots (no expected output is matched against them). They
exist for human eyeballing — `cat` one, scroll through the structure,
spot anomalies that would be tedious to assert in a test.

The producer is a pure function from `ModelInstance` to `DiagramLayout`
(no OMC contact). The fixtures it consumes (`*.modelInstance.fixture.json`)
are committed copies; the `*.modelInstance.json` filenames are gitignored
because they're regenerated on demand by `pnpm capture-modelinstance-fixtures`,
but the `.fixture.json` versions used here are pinned and tracked.
