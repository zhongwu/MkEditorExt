// Messages exchanged between the extension host and the webview (PLAN.md §3.2).
// This file is imported by both sides, so it must contain types and plain functions only.

/** A zero-based position, counted the same way as VS Code's `Position`. */
export interface LinePosition {
  line: number;
  character: number;
}

/**
 * One replacement. Ranges refer to the document as it was *before* the edit,
 * for every change in the same message (the same rule `WorkspaceEdit` uses).
 */
export interface TextChange {
  range: { start: LinePosition; end: LinePosition };
  text: string;
}

/** Messages handled by DocumentSync. */
export type SyncMessage =
  | { type: 'ready' }
  | { type: 'edit'; id: number; baseVersion: number; changes: TextChange[] }
  | { type: 'undo' }
  | { type: 'redo' };

export type WebviewMessage = SyncMessage | { type: 'openLink'; href: string };

/** Settings the webview needs, from the `mdEditor.*` configuration. */
export interface EditorSettings {
  /** CSS font-family for prose; empty means VS Code's UI font. */
  proseFontFamily: string;
}

/**
 * Every `edit` is answered by exactly one `ack` or one `replace` carrying its `id`.
 * A `replace` without an `id` reports a change made outside the webview.
 */
export type SyncHostMessage =
  | { type: 'init'; text: string; version: number }
  | { type: 'ack'; id: number; version: number }
  | { type: 'replace'; text: string; version: number; id?: number };

export type HostMessage = SyncHostMessage | { type: 'settings'; settings: EditorSettings };

/** Longest link target the host will try to open. */
const MAX_HREF_LENGTH = 2048;

function isPosition(value: unknown): value is LinePosition {
  const p = value as LinePosition;
  return (
    typeof p === 'object' &&
    p !== null &&
    Number.isInteger(p.line) &&
    Number.isInteger(p.character) &&
    p.line >= 0 &&
    p.character >= 0
  );
}

function isTextChange(value: unknown): value is TextChange {
  const c = value as TextChange;
  return (
    typeof c === 'object' &&
    c !== null &&
    typeof c.text === 'string' &&
    typeof c.range === 'object' &&
    c.range !== null &&
    isPosition(c.range.start) &&
    isPosition(c.range.end)
  );
}

/** Checks a message from the webview before the host acts on it. */
export function isWebviewMessage(value: unknown): value is WebviewMessage {
  const m = value as WebviewMessage;
  if (typeof m !== 'object' || m === null) {
    return false;
  }
  switch (m.type) {
    case 'ready':
    case 'undo':
    case 'redo':
      return true;
    case 'edit':
      return (
        Number.isInteger(m.id) &&
        Number.isInteger(m.baseVersion) &&
        Array.isArray(m.changes) &&
        m.changes.every(isTextChange)
      );
    case 'openLink':
      return typeof m.href === 'string' && m.href.length <= MAX_HREF_LENGTH;
    default:
      return false;
  }
}
