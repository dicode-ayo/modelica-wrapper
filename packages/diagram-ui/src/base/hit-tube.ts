import {
  Mesh,
  MeshBuilder,
  StandardMaterial,
  type Color3,
  type Scene,
  type Vector3,
} from "@babylonjs/core";

/**
 * Builds one invisible, pickable mesh covering every segment of a polyline
 * — a "hit tube" that gives a thin line a grabbable volume `scene.pick` can
 * land on (picking a zero-width GL line is unreliable). `CreateTube` can't
 * span disjoint segments, so per-segment tubes are merged into one mesh.
 *
 * Rendered at `visibility = 0` so it stays pickable — Babylon's default
 * pick predicate skips `isVisible = false` meshes but ignores `visibility`.
 * Raising visibility reveals it as a hover band in `color`.
 *
 * Shared by connection edges and poly host shapes so both get the same
 * follow-the-line pick behaviour.
 */
export function buildHitTube(
  scene: Scene,
  name: string,
  points: ReadonlyArray<Vector3>,
  radius: number,
  color: Color3,
): Mesh {
  const segments: Mesh[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) {
      continue;
    }
    segments.push(
      MeshBuilder.CreateTube(
        `${name}.${i}`,
        { path: [a, b], radius, tessellation: 6, cap: 0, updatable: false },
        scene,
      ),
    );
  }
  const first = segments[0];
  const merged =
    first === undefined
      ? new Mesh(name, scene)
      : segments.length === 1
        ? first
        : (Mesh.MergeMeshes(segments, true, true) ?? first);
  merged.name = name;
  const material = new StandardMaterial(`${name}.mat`, scene);
  material.disableLighting = true;
  material.emissiveColor = color;
  merged.material = material;
  merged.visibility = 0;
  merged.isPickable = first !== undefined;
  return merged;
}
