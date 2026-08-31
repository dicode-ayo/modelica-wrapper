/**
 * happy-dom assigns slots but never exposes the inverse `Element.assignedSlot`,
 * so it reads as `undefined` where the spec requires an `HTMLSlotElement` or
 * `null`. `@lit-labs/virtualizer` walks ancestors via `el.assignedSlot !== null`
 * and follows whatever it gets back, so the undefined clears that guard and the
 * next hop dereferences it, failing the run with an unhandled rejection.
 *
 * Assignment is read back out of happy-dom's own `assignedNodes()` rather than
 * re-deriving it from `slot` attributes, so the answer cannot disagree with the
 * assignment happy-dom actually made. The `in` guard keeps this inert once
 * happy-dom implements the property itself.
 */
if (!("assignedSlot" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "assignedSlot", {
    get(this: Element): HTMLSlotElement | null {
      const root = this.parentElement?.shadowRoot;
      if (!root) return null;
      for (const slot of root.querySelectorAll("slot")) {
        if (slot.assignedNodes().includes(this)) return slot;
      }
      return null;
    },
    configurable: true,
  });
}
