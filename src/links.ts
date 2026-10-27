// Decides what a Ctrl/Cmd+clicked link in the editor should open.
// No dependency on the `vscode` module, so it can be unit-tested.

export type LinkTarget =
  /** A web or mail link, opened outside VS Code. */
  | { kind: 'external'; url: string }
  /** A file path, relative to the document unless absolute. */
  | { kind: 'file'; path: string; fragment?: string }
  /** A heading in the same document, e.g. `#install`. */
  | { kind: 'anchor'; fragment: string };

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto']);

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Returns where a link points, or undefined if it must not be opened.
 * Only http, https and mailto links leave VS Code; other schemes (`command:`, `file:`,
 * `vscode:`, `javascript:` …) are refused, since a Markdown file can come from anywhere.
 */
export function classifyLink(href: string): LinkTarget | undefined {
  const link = href.trim();
  if (!link) {
    return undefined;
  }
  if (link.startsWith('#')) {
    return { kind: 'anchor', fragment: decode(link.slice(1)) };
  }

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(link);
  // A single letter before ":" is a Windows drive (C:\notes.md), not a scheme.
  if (scheme && scheme[1].length > 1) {
    return ALLOWED_SCHEMES.has(scheme[1].toLowerCase())
      ? { kind: 'external', url: link }
      : undefined;
  }

  const hash = link.indexOf('#');
  const withoutFragment = hash >= 0 ? link.slice(0, hash) : link;
  const query = withoutFragment.indexOf('?');
  const path = decode(query >= 0 ? withoutFragment.slice(0, query) : withoutFragment);
  if (!path) {
    return undefined;
  }
  const fragment = hash >= 0 ? decode(link.slice(hash + 1)) : undefined;
  return fragment ? { kind: 'file', path, fragment } : { kind: 'file', path };
}
