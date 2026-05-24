# Real Icon Fixtures

JSON snapshots of `iconLayers` captured from real Modelica classes via OMC, consumed by `stories/RealIcons.stories.ts` for visual review.

## Regenerate

```sh
pnpm --filter @dicode/diagram-svg capture-icons
```

Requires `omc` on PATH (or the `OMC_PATH` env var). The script:

1. Spawns OMC, loads MSL.
2. Calls `getModelInstance` for each target class (Sin, Gain, Add, Constant).
3. Runs `produceDiagramLayout(mi, "icon")` and writes `<slug>.icon.json`.
4. For PID_Controller's sub-components (LimPID, Inertia, SpringDamper, Torque), captures `getModelInstance` for the host model and extracts each class from `layout.classes`.

After capture, commit the regenerated JSON files. They are visual references — small (typically 1–10 KB each), git-tracked, and stable across patch-level MSL bumps.

## Why not regenerate in CI?

The CI Chromatic job runs in a non-OMC container. Capture is a manual step; baselines update when a maintainer re-captures (e.g. on a Modelica Standard Library upgrade) and pushes the diff.
