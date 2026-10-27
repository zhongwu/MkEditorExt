// The webview half of the sync protocol (PLAN.md §3.3–3.4).
// Uses only @codemirror/state, so it runs in unit tests without a DOM.

import type { ChangeSet, Text } from '@codemirror/state';
import type { HostMessage, LinePosition, TextChange, WebviewMessage } from '../src/protocol';

export function toLinePosition(doc: Text, pos: number): LinePosition {
  const line = doc.lineAt(pos);
  return { line: line.number - 1, character: pos - line.from };
}

/** Converts CodeMirror changes to line/character changes, all relative to `startDoc`. */
export function toTextChanges(changes: ChangeSet, startDoc: Text): TextChange[] {
  const result: TextChange[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    result.push({
      range: { start: toLinePosition(startDoc, fromA), end: toLinePosition(startDoc, toA) },
      text: inserted.toString(),
    });
  });
  return result;
}

/** Text from the host keeps the file's own line endings; CodeMirror only uses `\n`. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** The smallest single replacement that turns `oldText` into `newText`, or null if they're equal. */
export function minimalChange(
  oldText: string,
  newText: string,
): { from: number; to: number; insert: string } | null {
  if (oldText === newText) {
    return null;
  }
  const max = Math.min(oldText.length, newText.length);
  let start = 0;
  while (start < max && oldText.charCodeAt(start) === newText.charCodeAt(start)) {
    start++;
  }
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)
  ) {
    oldEnd--;
    newEnd--;
  }
  return { from: start, to: oldEnd, insert: newText.slice(start, newEnd) };
}

/**
 * Sends local edits to the host with at most one in flight.
 * Changes made while waiting are combined and sent together after the `ack`.
 */
export class WebviewSync {
  private version = -1;
  private nextId = 1;
  private inFlight: number | undefined;
  private pending: { changes: ChangeSet; startDoc: Text } | undefined;
  /** An outside change replaced the text while our edit was in flight. */
  private replacedDuringFlight = false;

  constructor(private readonly post: (message: WebviewMessage) => void) {}

  /**
   * Handles a message from the host. `setText` must replace the editor's text with the given
   * text (line endings already normalized) as a remote change. Returns true if the webview
   * needs a full resync, which it gets by sending `ready` again.
   */
  receive(message: HostMessage, setText: (text: string) => void): boolean {
    switch (message.type) {
      case 'init':
        setText(normalizeLineEndings(message.text));
        this.reset(message.version);
        return false;
      case 'ack':
        return !this.ack(message.id, message.version);
      case 'replace':
        setText(normalizeLineEndings(message.text));
        this.replaced(message.version, message.id);
        return false;
    }
  }

  /** After `init`: the text now matches `version` and nothing is outstanding. */
  reset(version: number): void {
    this.version = version;
    this.inFlight = undefined;
    this.pending = undefined;
    this.replacedDuringFlight = false;
  }

  /** Call for every local (non-remote) document change, with the doc it was applied to. */
  localChange(changes: ChangeSet, startDoc: Text): void {
    if (changes.empty) {
      return;
    }
    if (this.inFlight === undefined) {
      this.send(changes, startDoc);
    } else if (this.pending) {
      this.pending = {
        changes: this.pending.changes.compose(changes),
        startDoc: this.pending.startDoc,
      };
    } else {
      this.pending = { changes, startDoc };
    }
  }

  /**
   * Handles `ack`. Returns false if the webview's text can no longer be trusted
   * and a full resync is needed.
   */
  private ack(id: number, version: number): boolean {
    if (id !== this.inFlight) {
      return true;
    }
    this.inFlight = undefined;
    this.version = version;
    if (this.replacedDuringFlight) {
      // Our edit landed after we had already overwritten it with an outside change.
      this.replacedDuringFlight = false;
      this.pending = undefined;
      return false;
    }
    this.flushPending();
    return true;
  }

  /** Call after the webview's text has been replaced with the host's text from `replace`. */
  private replaced(version: number, id: number | undefined): void {
    this.version = version;
    // The replaced text already contains (or discards) everything typed so far.
    this.pending = undefined;
    if (id !== undefined && id === this.inFlight) {
      this.inFlight = undefined;
      this.replacedDuringFlight = false;
    } else if (this.inFlight !== undefined) {
      this.replacedDuringFlight = true;
    }
  }

  private flushPending(): void {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      this.send(pending.changes, pending.startDoc);
    }
  }

  private send(changes: ChangeSet, startDoc: Text): void {
    const id = this.nextId++;
    this.inFlight = id;
    this.post({
      type: 'edit',
      id,
      baseVersion: this.version,
      changes: toTextChanges(changes, startDoc),
    });
  }
}
