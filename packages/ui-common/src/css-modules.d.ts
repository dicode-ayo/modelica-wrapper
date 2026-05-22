/**
 * Ambient declarations for bundler-handled asset imports.
 *
 * The package is consumed via Vite / esbuild (Storybook + the extension
 * webviews). Bare CSS imports resolve as side-effect modules served as a
 * style tag; TypeScript doesn't know that convention, so we declare the
 * wildcard module here. Callers always use `import "..."` (no binding).
 */
declare module "*.css";
