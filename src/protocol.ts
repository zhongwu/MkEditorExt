// Messages exchanged between the extension host and the webview (PLAN.md §3.2).
// This file is imported by both sides, so it must contain types and plain functions only.

import { IMAGE_TYPES } from './images';

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

/** How the editor shows the document (PLAN.md §3.5). */
export type Mode = 'live' | 'source' | 'reading';

export const MODES: readonly Mode[] = ['live', 'source', 'reading'];

/** Messages handled by DocumentSync. */
export type SyncMessage =
  | { type: 'ready' }
  | { type: 'edit'; id: number; baseVersion: number; changes: TextChange[] }
  | { type: 'undo' }
  | { type: 'redo' };

export type WebviewMessage =
  | SyncMessage
  | { type: 'openLink'; href: string }
  | { type: 'setMode'; mode: Mode }
  /** An image from the clipboard or a drop; `data` is its bytes in base64. */
  /** Ask the host to let the user pick an image file to insert. */
  | { type: 'chooseImage' }
  | { type: 'pasteImage'; id: number; name: string; mime: string; data: string };

/** Settings the webview needs, from the `mdEditor.*` configuration. */
export interface EditorSettings {
  /** CSS font-family for prose; empty means VS Code's UI font. */
  proseFontFamily: string;
  /** The document's folder as a webview URI, for resolving relative image paths. */
  baseUri: string;
  /** Draw raw HTML blocks, sanitized, instead of showing their source. */
  renderHtml: boolean;
}

/**
 * Every `edit` is answered by exactly one `ack` or one `replace` carrying its `id`.
 * A `replace` without an `id` reports a change made outside the webview.
 */
export type SyncHostMessage =
  | { type: 'init'; text: string; version: number }
  | { type: 'ack'; id: number; version: number }
  | { type: 'replace'; text: string; version: number; id?: number };

/** `mode` is sent before `init`, and again when the `mdEditor.setMode` command changes it. */
export type HostMessage =
  | SyncHostMessage
  | { type: 'settings'; settings: EditorSettings }
  | { type: 'mode'; mode: Mode }
  /** The image sent as `pasteImage` `id` was saved at `path`, relative to the document. */
  | { type: 'imageSaved'; id: number; path: string; alt?: string }
  /** Put the cursor at the start of this line and scroll it into view. */
  | { type: 'revealLine'; line: number };

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
    case 'chooseImage':
      return true;
    case 'setMode':
      return MODES.includes(m.mode);
    case 'pasteImage':
      return (
        Number.isInteger(m.id) &&
        typeof m.name === 'string' &&
        m.name.length <= 255 &&
        typeof m.mime === 'string' &&
        Object.hasOwn(IMAGE_TYPES, m.mime) &&
        typeof m.data === 'string'
      );
    default:
      return false;
  }
}
