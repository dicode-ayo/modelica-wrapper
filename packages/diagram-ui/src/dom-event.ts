/**
 * Dispatch a bubbling, composed `CustomEvent` from a host element. The single
 * source of truth for the diagram components' event contract (`bubbles` +
 * `composed`, so events cross shadow boundaries to the embedding host).
 */
export function emitEvent(
  host: EventTarget,
  type: string,
  detail: unknown,
): void {
  host.dispatchEvent(
    new CustomEvent(type, { detail, bubbles: true, composed: true }),
  );
}
