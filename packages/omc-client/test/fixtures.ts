/**
 * Test fixtures for integration tests that mutate the OMC symbol table.
 *
 * Each fixture loads a small throwaway package via `loadString` with a unique
 * random suffix to avoid name clashes across parallel test files. Tests
 * mutate the package's contained classes (add components, add connections,
 * rename, delete) and `disposeFixture()` cleans up via `deleteClass`.
 *
 * Why a fresh package per test instead of mutating Modelica.* directly:
 * tests must be isolated. Mutating the loaded `Modelica` library would
 * corrupt subsequent tests in the same run.
 */

import { randomBytes } from "node:crypto";

import type { OmcClient } from "../src/client.js";

/** A loaded test fixture: the wrapping package and the model class within it. */
export interface Fixture {
  /** Random package name, e.g. `MwTest_a1b2c3d4`. */
  packageName: string;
  /** The fully-qualified model class to mutate, e.g. `MwTest_a1b2c3d4.Sample`. */
  modelClass: string;
}

/**
 * Load a fresh throwaway package containing a single empty `model Sample`.
 * Caller mutates `fixture.modelClass` directly; call `disposeFixture` at the
 * end (or rely on the OMC subprocess shutdown via `client.close()`).
 */
export async function loadFixture(client: OmcClient): Promise<Fixture> {
  const packageName = `MwTest_${randomBytes(4).toString("hex")}`;
  const modelClass = `${packageName}.Sample`;
  const data = `package ${packageName}
  model Sample
  end Sample;
end ${packageName};
`;
  const { success } = await client.loadString({
    data,
    filename: `<fixture:${packageName}>`,
  });
  if (!success) {
    const { errorString } = await client.getErrorString();
    throw new Error(
      `loadFixture: loadString failed for ${packageName}: ${errorString}`,
    );
  }
  return { packageName, modelClass };
}

/**
 * Load a fixture containing a richer model with a single Real parameter,
 * suitable for component-modifier and editing tests.
 */
export async function loadParameterFixture(
  client: OmcClient,
): Promise<Fixture> {
  const packageName = `MwTest_${randomBytes(4).toString("hex")}`;
  const modelClass = `${packageName}.Sample`;
  const data = `package ${packageName}
  model Sample
    parameter Real k = 1.0;
    Real x;
  equation
    x = k;
  end Sample;
end ${packageName};
`;
  const { success } = await client.loadString({
    data,
    filename: `<fixture:${packageName}>`,
  });
  if (!success) {
    const { errorString } = await client.getErrorString();
    throw new Error(`loadParameterFixture: ${errorString}`);
  }
  return { packageName, modelClass };
}

/**
 * Load a fixture that `extends Modelica.Blocks.Math.Gain(k=2.5)` so tests
 * can exercise extends-clause modifier reads/writes. Caller must have
 * already loaded the `Modelica` library.
 */
export async function loadExtendsFixture(client: OmcClient): Promise<Fixture> {
  const packageName = `MwTest_${randomBytes(4).toString("hex")}`;
  const modelClass = `${packageName}.Sample`;
  const data = `package ${packageName}
  block Sample
    extends Modelica.Blocks.Math.Gain(k=2.5);
  end Sample;
end ${packageName};
`;
  const { success } = await client.loadString({
    data,
    filename: `<fixture:${packageName}>`,
  });
  if (!success) {
    const { errorString } = await client.getErrorString();
    throw new Error(`loadExtendsFixture: ${errorString}`);
  }
  return { packageName, modelClass };
}

/**
 * A loaded `extends`-clause fixture with a self-contained base/derived pair:
 *
 * ```modelica
 * package P
 *   model Base
 *     parameter Real k = 1.0;
 *   end Base;
 *   model Derived
 *     extends Base(k = 2.5);
 *   end Derived;
 * end P;
 * ```
 *
 * Unlike `loadExtendsFixture` (which extends `Modelica.Blocks.Math.Gain`),
 * this fixture defines its own base class so the modifier is declared inside
 * the same package — no `Modelica` library load required, and the
 * `getExtendsModifier*` read path surfaces the `k` modifier on the pin.
 */
export interface DerivedExtendsFixture extends Fixture {
  /** The base model, e.g. `MwTest_a1b2c3d4.Base`. */
  baseClass: string;
  /** The derived model carrying the `extends Base(k = 2.5)` clause. */
  derivedClass: string;
}

export async function loadDerivedExtendsFixture(
  client: OmcClient,
): Promise<DerivedExtendsFixture> {
  const packageName = `MwTest_${randomBytes(4).toString("hex")}`;
  const baseClass = `${packageName}.Base`;
  const derivedClass = `${packageName}.Derived`;
  const data = `package ${packageName}
  model Base
    parameter Real k = 1.0;
  end Base;
  model Derived
    extends Base(k = 2.5);
  end Derived;
end ${packageName};
`;
  const { success } = await client.loadString({
    data,
    filename: `<fixture:${packageName}>`,
  });
  if (!success) {
    const { errorString } = await client.getErrorString();
    throw new Error(`loadDerivedExtendsFixture: ${errorString}`);
  }
  // `modelClass` points at the derived class — that's the one tests mutate.
  return { packageName, modelClass: derivedClass, baseClass, derivedClass };
}

/** Best-effort cleanup. Errors are swallowed — the OMC subprocess dies anyway. */
export async function disposeFixture(
  client: OmcClient,
  fixture: Fixture,
): Promise<void> {
  try {
    await client.deleteClass({ typeName: fixture.packageName });
  } catch {
    // Already gone, OMC closing, etc. — nothing to do.
  }
}
