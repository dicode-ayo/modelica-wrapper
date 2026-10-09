/**
 * OMC answered the request, and the answer is a failure the caller can act on.
 * Distinguishes it from a transport fault or a dead client, which reach the
 * same `catch`.
 *
 * Free of Node imports so browser bundles that reach `_shared/` can subclass
 * it.
 */
export class OmcDiagnosticError extends Error {}
