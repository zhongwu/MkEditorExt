// Decides which URL an image in the document is loaded from. No DOM, so it can be unit-tested.

/**
 * Turns the `src` of a Markdown image into a URL the webview may load, or undefined if it must
 * not be loaded. `baseUri` is the document's folder as a webview URI (from the host).
 * Web images and `data:` images load as they are; other relative paths resolve against the
 * document's folder. Other schemes (`file:`, `vscode-resource:` …) and absolute paths are refused.
 */
export function resolveImageSrc(src: string, baseUri: string): string | undefined {
  const value = src.trim().replace(/^<(.*)>$/, '$1');
  if (!value) {
    return undefined;
  }
  if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) {
    return value;
  }
  const isDrive = /^[a-z]:[\\/]/i.test(value);
  if (isDrive || value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return undefined;
  }
  if (!baseUri) {
    return undefined;
  }
  try {
    return new URL(value.replaceAll('\\', '/'), baseUri.endsWith('/') ? baseUri : `${baseUri}/`)
      .href;
  } catch {
    return undefined;
  }
}
