/**
 * Ambient declarations for bundler-handled asset imports.
 *
 * The package is consumed via Vite (Storybook + the extension webview).
 * Vite resolves bare CSS imports as side-effect modules and serves the
 * file as a style tag. TypeScript itself doesn't know about that
 * convention, so we declare the wildcard module here. Returning `void`
 * is fine because callers always use `import "..."` (no binding).
 */
declare module "*.css";
