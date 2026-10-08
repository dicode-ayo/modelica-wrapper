/**
 * A failure OMC reported through its error buffer rather than by throwing.
 * Distinguishes an answer the caller can act on from a transport fault or a
 * dead client, which reach the same `catch`.
 *
 * Free of Node imports so browser bundles that reach `_shared/` can subclass
 * it.
 */
export class OmcDiagnosticError extends Error {}
