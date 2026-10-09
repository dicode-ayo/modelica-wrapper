/**
 * OMC's answer about a request — a reason from its error buffer, or a reply
 * whose shape says the class is missing or partly loaded — rather than a
 * transport fault or a dead client, which reach the same `catch`.
 *
 * Free of Node imports so browser bundles that reach `_shared/` can subclass
 * it.
 */
export class OmcDiagnosticError extends Error {}
