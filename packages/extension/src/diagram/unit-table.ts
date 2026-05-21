/**
 * Host-side, SESSION-CACHED unit table + conversion helper (issue #72 / the
 * parameter-model refactor in `docs/parameter-model-design.md`).
 *
 * The producer (`produceParameterModel`) is pure; the two facts it can't derive
 * from the AST — the alternative-unit list (`getDerivedUnits`) and the affine
 * conversion factors (`convertUnits`) — are fetched HOST-SIDE here and injected
 * as a `UnitTable`. Both the parameter form (its `unitOptions`) and the diagram
 * value-labels (`applyDisplayUnits`) consume the SAME cached table / conversion
 * map, so a given class's unit calls are issued at most once per OMC session and
 * are never duplicated between the form and the labels.
 *
 * The cache is whole-session with no invalidation: unit definitions are static
 * within an OMC session (see the design note's "Cache invalidation" risk).
 * Keyed off the `OmcClient` via a module-level `WeakMap` so every panel open and
 * every label render through the same client shares it; a new client (new OMC
 * session) gets a fresh cache.
 *
 * Two caches per session:
 *  - `derived: baseUnit → string[]`                     (getDerivedUnits)
 *  - `convert: "s1\ts2" → ConvertUnitsOutput | undefined` (convertUnits)
 *
 * The `UnitTable` entries (`{unit, scaleFactor, offset}[]`) are derived from
 * those two and memoised per base unit. All lookups are best-effort: a
 * `getDerivedUnits` / `convertUnits` throw or incompatible verdict drops that
 * option (or leaves the base unit alone) so units stay VISIBLE even if a lookup
 * partially fails.
 */

import type {
  OmcClient,
  ParameterModel,
  UnitOption,
  UnitTable,
} from "@modelica-wrapper/omc-client";
import { collectBaseUnits } from "@modelica-wrapper/omc-client";
import type { ConvertUnitsOutput } from "@modelica-wrapper/omc-client/api/contents/index.js";

/** Logger seam — the extension passes `log.warn`; tests pass a noop. */
export type WarnFn = (topic: string, message: string, data?: unknown) => void;

/** OMC's dimensionless placeholder — no derived units, nothing to convert. */
const DIMENSIONLESS_UNIT = "1";

/**
 * Per-`OmcClient` (per-session) unit cache. Holds the raw `getDerivedUnits` /
 * `convertUnits` results plus a memoised `UnitTable` entry per base unit, so a
 * base unit's lookups happen once and are reused across every panel open AND
 * every diagram label render for the life of the session.
 */
export class SessionUnitCache {
  /** baseUnit → derived unit list (getDerivedUnits). */
  private readonly derived = new Map<string, string[]>();
  /** "s1\ts2" → convertUnits result (undefined = couldn't resolve). */
  private readonly convert = new Map<string, ConvertUnitsOutput | undefined>();
  /** baseUnit → memoised UnitTable option list. */
  private readonly optionList = new Map<string, ReadonlyArray<UnitOption>>();

  constructor(
    private readonly client: OmcClient,
    private readonly warn: WarnFn = () => {},
  ) {}

  /**
   * Resolve `convertUnits(s1, s2)` once per pair, cached for the session.
   * Returns `undefined` when OMC threw — callers treat that as "leave the
   * value as-is". The identity pair (`s1 === s2`) short-circuits to
   * `{compatible, 1, 0}` with no round-trip.
   */
  async convertUnits(
    s1: string,
    s2: string,
  ): Promise<ConvertUnitsOutput | undefined> {
    if (s1 === s2) return { unitsCompatible: true, scaleFactor: 1, offset: 0 };
    const key = `${s1}\t${s2}`;
    if (this.convert.has(key)) return this.convert.get(key);
    let conv: ConvertUnitsOutput | undefined;
    try {
      conv = await this.client.convertUnits({ s1, s2 });
    } catch (err) {
      this.warn(
        "sessionUnitCache",
        `convertUnits(${s1}, ${s2}) failed`,
        err instanceof Error ? err.message : err,
      );
      conv = undefined;
    }
    this.convert.set(key, conv);
    return conv;
  }

  /** Resolve `getDerivedUnits(baseUnit)` once per base unit, cached. */
  private async derivedUnits(baseUnit: string): Promise<string[]> {
    const hit = this.derived.get(baseUnit);
    if (hit !== undefined) return hit;
    let list: string[];
    try {
      list = (await this.client.getDerivedUnits({ baseUnit })).derivedUnits;
    } catch (err) {
      this.warn(
        "sessionUnitCache",
        `getDerivedUnits(${baseUnit}) failed`,
        err instanceof Error ? err.message : err,
      );
      list = [];
    }
    this.derived.set(baseUnit, list);
    return list;
  }

  /**
   * Build (and memoise) the unit option list for a base unit:
   * `[unit, ...derivedUnits]` deduplicated, declaration-unit first, each with
   * its `convertUnits(baseUnit, option)` factors. Incompatible / throwing
   * options are dropped; the list always keeps at least the identity option so
   * the form renders a suffix. Mirrors OMEdit `ElementProperties.cpp:242-266`.
   */
  private async optionsFor(baseUnit: string): Promise<ReadonlyArray<UnitOption>> {
    const cached = this.optionList.get(baseUnit);
    if (cached !== undefined) return cached;

    const seen = new Set<string>();
    const ordered: string[] = [];
    const push = (u: string | undefined): void => {
      const t = u?.trim();
      if (!t || seen.has(t)) return;
      seen.add(t);
      ordered.push(t);
    };
    push(baseUnit);
    for (const d of await this.derivedUnits(baseUnit)) push(d);

    const out: UnitOption[] = [];
    for (const optUnit of ordered) {
      if (optUnit === baseUnit) {
        out.push({ unit: optUnit, scaleFactor: 1, offset: 0 });
        continue;
      }
      const conv = await this.convertUnits(baseUnit, optUnit);
      if (!conv || !conv.unitsCompatible) continue;
      if (!Number.isFinite(conv.scaleFactor) || conv.scaleFactor === 0) continue;
      if (!Number.isFinite(conv.offset)) continue;
      out.push({ unit: optUnit, scaleFactor: conv.scaleFactor, offset: conv.offset });
    }
    const result: ReadonlyArray<UnitOption> =
      out.length > 0 ? out : [{ unit: baseUnit, scaleFactor: 1, offset: 0 }];
    this.optionList.set(baseUnit, result);
    return result;
  }

  /**
   * Append any declared `displayUnit`s (`extras`) that aren't already in the
   * memoised `getDerivedUnits`-based list, with their `convertUnits(base, du)`
   * factors. Mirrors the old `enrichUnitOptions`, which pushed the field's
   * `displayUnit` into the option list unconditionally so the form could
   * default-select it — `getDerivedUnits` covers the standard display units for
   * SI bases, but a parameter may declare a `displayUnit` outside that set, and
   * dropping it would silently fall the form back to the base unit (a behaviour
   * regression vs. the pre-refactor enrichment).
   *
   * The base list stays memoised per base unit (`optionsFor`); the per-field
   * extras are folded on top here. Conversions are session-cached, so the extra
   * lookup is free on re-open. Extras that are incompatible / non-finite are
   * dropped (the form just won't offer that unit).
   */
  private async withExtraUnits(
    baseUnit: string,
    base: ReadonlyArray<UnitOption>,
    extras: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<UnitOption>> {
    const have = new Set(base.map((o) => o.unit));
    const additions: UnitOption[] = [];
    for (const extra of extras) {
      const u = extra.trim();
      if (!u || u === baseUnit || have.has(u)) continue;
      have.add(u);
      const conv = await this.convertUnits(baseUnit, u);
      if (!conv || !conv.unitsCompatible) continue;
      if (!Number.isFinite(conv.scaleFactor) || conv.scaleFactor === 0) continue;
      if (!Number.isFinite(conv.offset)) continue;
      additions.push({ unit: u, scaleFactor: conv.scaleFactor, offset: conv.offset });
    }
    return additions.length > 0 ? [...base, ...additions] : base;
  }

  /**
   * Build a `UnitTable` covering the given base units. Reuses memoised entries,
   * so re-opening a panel for a class whose base units were already resolved
   * issues zero new OMC calls. Skips empty / dimensionless `"1"` base units.
   *
   * `extraUnitsByBase` (optional) carries declared `displayUnit`s per base unit;
   * any not already in the derived list are folded into that base's option list
   * (see `withExtraUnits`) so a non-standard `displayUnit` stays selectable.
   */
  async buildUnitTable(
    baseUnits: ReadonlyArray<string>,
    extraUnitsByBase?: ReadonlyMap<string, ReadonlyArray<string>>,
  ): Promise<UnitTable> {
    const table = new Map<string, ReadonlyArray<UnitOption>>();
    for (const unit of baseUnits) {
      const u = unit.trim();
      if (!u || u === DIMENSIONLESS_UNIT) continue;
      if (table.has(u)) continue;
      let options = await this.optionsFor(u);
      const extras = extraUnitsByBase?.get(u);
      if (extras && extras.length > 0) {
        options = await this.withExtraUnits(u, options, extras);
      }
      table.set(u, options);
    }
    return table;
  }
}

/**
 * Map each base unit in a parameter model to the distinct `displayUnit`s its
 * fields declare (excluding the base unit itself and the dimensionless `"1"`).
 * The host feeds this to `buildUnitTable` so a declared `displayUnit` outside
 * `getDerivedUnits` is still offered in the dropdown.
 */
export function collectDisplayUnitsByBase(
  model: ParameterModel,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of model.fields) {
    const base = f.unit?.trim();
    const du = f.displayUnit?.trim();
    if (!base || base === DIMENSIONLESS_UNIT) continue;
    if (!du || du === base) continue;
    let list = out.get(base);
    if (list === undefined) {
      list = [];
      out.set(base, list);
    }
    if (!list.includes(du)) list.push(du);
  }
  return out;
}

/** Module-level per-client cache registry — one `SessionUnitCache` per session. */
const caches = new WeakMap<OmcClient, SessionUnitCache>();

/**
 * Get (or lazily create) the session-level unit cache for `client`. Shared
 * across every panel open and every label render for the life of the client.
 */
export function sessionUnitCache(
  client: OmcClient,
  warn: WarnFn = () => {},
): SessionUnitCache {
  let cache = caches.get(client);
  if (cache === undefined) {
    cache = new SessionUnitCache(client, warn);
    caches.set(client, cache);
  }
  return cache;
}

/**
 * Build a `UnitTable` for a parameter model's base units via the session cache
 * keyed off `client`. Whole-pass best-effort: per-unit OMC failures are already
 * swallowed inside the cache (leaving a static suffix); this guard catches any
 * unexpected throw so a flaky OMC opens the form without unit dropdowns rather
 * than blocking it.
 */
export async function buildUnitTableForModel(
  client: OmcClient,
  model: ParameterModel,
  warn: WarnFn = () => {},
): Promise<UnitTable> {
  try {
    return await sessionUnitCache(client, warn).buildUnitTable(
      collectBaseUnits(model),
      collectDisplayUnitsByBase(model),
    );
  } catch (err) {
    warn(
      "buildUnitTable",
      "unit-table build failed; form opens without unit dropdowns",
      err instanceof Error ? err.message : err,
    );
    return new Map();
  }
}
