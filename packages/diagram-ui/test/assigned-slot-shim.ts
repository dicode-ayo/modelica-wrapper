/**
 * happy-dom leaves `Element.assignedSlot` undefined; the DOM spec requires
 * `null` for an element that is not slotted. `@lit-labs/virtualizer` walks
 * ancestors via `el.assignedSlot !== null` and returns whatever it finds, so
 * an undefined passes that guard and the next hop dereferences it — the
 * library tree's virtualizer takes down the run with an unhandled rejection.
 *
 * The `in` guard keeps this inert once happy-dom implements slot assignment.
 */
if (!("assignedSlot" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "assignedSlot", {
    get: () => null,
    configurable: true,
  });
}
