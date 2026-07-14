import DOMPurify from "dompurify";

export interface SanitizedDoc {
  /** Sanitized HTML safe to inject: active markup (scripts, handlers) removed. */
  html: string;
  /** True when sanitizing left nothing renderable, so the empty state shows. */
  isEmpty: boolean;
}

/**
 * Classify an already-sanitized fragment into render-vs-empty-state. Split from
 * {@link sanitizeDoc} so the decision is exercisable without a DOM: DOMPurify
 * needs one, the whitespace check does not.
 */
export function classifySanitized(html: string): SanitizedDoc {
  return { html, isEmpty: html.trim().length === 0 };
}

/**
 * Sanitize a `Documentation(info=…)` fragment and classify the result. The
 * webview also runs under a nonce-only `script-src`, so this strips active
 * markup that the CSP would already keep inert.
 */
export function sanitizeDoc(info: string): SanitizedDoc {
  return classifySanitized(DOMPurify.sanitize(info));
}
