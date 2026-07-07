/**
 * Lit directive that adapts Headless Tree's React-shaped prop bag
 * (`item.getProps()`) onto a real DOM node: `ref` registers the element,
 * `onX` keys become native listeners, `style` merges as inline styles, and
 * the rest map to attributes / properties. Listeners are re-bound on every
 * update (the virtualizer recycles a row element across items), so stale
 * ones are torn down first.
 */

import { noChange } from "lit";
import {
  Directive,
  directive,
  PartType,
  type ElementPart,
  type PartInfo,
} from "lit/directive.js";

type PropBag = Record<string, unknown>;

class BindItemPropsDirective extends Directive {
  private listeners: Array<[string, EventListener]> = [];

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.ELEMENT) {
      throw new Error("bindItemProps can only be attached to an element");
    }
  }

  render(_props: PropBag): typeof noChange {
    return noChange;
  }

  override update(part: ElementPart, [props]: [PropBag]): typeof noChange {
    this.bind(part.element, props);
    return noChange;
  }

  private bind(element: Element, props: PropBag): void {
    for (const [type, listener] of this.listeners) {
      element.removeEventListener(type, listener);
    }
    const next: Array<[string, EventListener]> = [];

    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || key === "key") continue;

      if (key === "ref") {
        if (typeof value === "function") {
          (value as (el: Element) => void)(element);
        }
        continue;
      }
      if (typeof value === "function" && key.startsWith("on")) {
        const type = key.slice(2).toLowerCase();
        element.addEventListener(type, value as EventListener);
        next.push([type, value as EventListener]);
        continue;
      }
      if (key === "style" && typeof value === "object") {
        Object.assign((element as HTMLElement).style, value);
        continue;
      }
      if (key === "tabIndex") {
        (element as HTMLElement).tabIndex = Number(value);
        continue;
      }
      if (key === "draggable") {
        (element as HTMLElement).draggable = Boolean(value);
        continue;
      }
      element.setAttribute(key, String(value));
    }

    this.listeners = next;
  }
}

export const bindItemProps = directive(BindItemPropsDirective);
