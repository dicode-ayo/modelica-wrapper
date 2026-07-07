/**
 * Lit directive that adapts Headless Tree's React-shaped prop bag
 * (`item.getProps()`) onto a real DOM node: `ref` registers the element,
 * `onX` keys become native listeners, `style` merges as inline styles, and
 * the rest map to attributes / properties.
 *
 * The virtualizer recycles a row element across items, so whatever a bind
 * applies (listeners, attributes, style props) is tracked and the entries
 * absent from the next prop bag are cleared first — otherwise a stale key
 * from the previous item leaks onto the reused element.
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

const toKebabCase = (key: string): string =>
  key.startsWith("--")
    ? key
    : key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

class BindItemPropsDirective extends Directive {
  private listeners: Array<[string, EventListener]> = [];
  private attributes = new Set<string>();
  private styleProps = new Set<string>();

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
    const htmlEl = element as HTMLElement;
    for (const [type, listener] of this.listeners) {
      element.removeEventListener(type, listener);
    }
    const nextListeners: Array<[string, EventListener]> = [];
    const nextAttributes = new Set<string>();
    const nextStyleProps = new Set<string>();

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
        nextListeners.push([type, value as EventListener]);
        continue;
      }
      if (key === "style" && typeof value === "object") {
        for (const [prop, raw] of Object.entries(value as PropBag)) {
          if (raw === undefined || raw === null) continue;
          const name = toKebabCase(prop);
          htmlEl.style.setProperty(name, String(raw));
          nextStyleProps.add(name);
        }
        continue;
      }
      if (key === "tabIndex") {
        htmlEl.tabIndex = Number(value);
        continue;
      }
      if (key === "draggable") {
        htmlEl.draggable = Boolean(value);
        continue;
      }
      element.setAttribute(key, String(value));
      nextAttributes.add(key);
    }

    for (const attr of this.attributes) {
      if (!nextAttributes.has(attr)) element.removeAttribute(attr);
    }
    for (const prop of this.styleProps) {
      if (!nextStyleProps.has(prop)) htmlEl.style.removeProperty(prop);
    }

    this.listeners = nextListeners;
    this.attributes = nextAttributes;
    this.styleProps = nextStyleProps;
  }
}

export const bindItemProps = directive(BindItemPropsDirective);
