/**
 * Random nonce for a webview's Content-Security-Policy `script-src`. Shared by
 * every webview host (diagram panel, result view, library sidebar) so the CSP
 * boilerplate lives in one place.
 */
export function randomNonce(): string {
  let s = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}
