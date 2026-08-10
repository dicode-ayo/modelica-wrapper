/**
 * Modelica §18.6 defaults that depend on other fields of the same shape, and so
 * cannot be written as a constant in either the diff's normalization table or
 * the properties panel's field table. Both read them from here: a rule
 * transcribed twice is a rule that drifts, and a default that disagrees between
 * the two makes the panel offer a reset the diff then treats as a change.
 */

/**
 * §18.6.5.5: `Chord` for a full ellipse, `Radial` for an arc. Live OMC answers
 * the same, including for angles written out explicitly as 0 and 360.
 */
export function defaultEllipseClosure(
  startAngle: number | undefined,
  endAngle: number | undefined,
): string {
  return (startAngle ?? 0) === 0 && (endAngle ?? 360) === 360
    ? "Chord"
    : "Radial";
}
