import { describe, expect, it, vi } from 'vitest';
import { DocumentSync, type SyncHost } from '../../src/DocumentSync';
import type { HostMessage, TextChange } from '../../src/protocol';
import { applyTextChanges } from './helpers';

class FakeDocument {
  version = 1;
  constructor(public text: string) {}
  getText(): string {
    return this.text;
  }
}

type EventTiming = 'during' | 'after';

function setup(text = 'hello\nworld\n', options: { events?: EventTiming } = {}) {
  const doc = new FakeDocument(text);
  const posted: HostMessage[] = [];
  let result: boolean | 'throw' = true;
  const applyEdit = vi.fn(async (changes: readonly TextChange[]) => {
    if (result === 'throw') {
      throw new Error('boom');
    }
    if (!result) {
      return false;
    }
    const next = applyTextChanges(doc.text, changes);
    if (next !== doc.text) {
      doc.text = next;
      doc.version++;
      if (options.events === 'after') {
        // VS Code may deliver the change event after applyEdit has resolved.
        setTimeout(() => sync.onDocumentChanged(), 0);
      } else {
        sync.onDocumentChanged();
      }
    }
    return true;
  });
  const host: SyncHost = {
    applyEdit,
    post: (message) => posted.push(message),
    executeCommand: vi.fn(),
  };
  const sync = new DocumentSync(doc, host);
  return {
    doc,
    sync,
    host,
    posted,
    applyEdit,
    setResult: (r: boolean | 'throw') => (result = r),
    /** A change made outside the webview, e.g. by git or another editor. */
    outsideChange(newText: string) {
      doc.text = newText;
      doc.version++;
      sync.onDocumentChanged();
    },
  };
}

const insertAt = (line: number, character: number, text: string): TextChange => ({
  range: { start: { line, character }, end: { line, character } },
  text,
});

describe('DocumentSync', () => {
  it('answers ready with the full text and version', async () => {
    const { sync, posted } = setup('abc');
    await sync.handleMessage({ type: 'ready' });
    expect(posted).toEqual([{ type: 'init', text: 'abc', version: 1 }]);
  });

  it('acknowledges its own edit exactly once', async () => {
    const { sync, posted, doc } = setup();
    await sync.handleMessage({
      type: 'edit',
      id: 7,
      baseVersion: 1,
      changes: [insertAt(0, 5, '!')],
    });
    expect(doc.text).toBe('hello!\nworld\n');
    expect(posted).toEqual([{ type: 'ack', id: 7, version: 2 }]);
  });

  it('acknowledges once when the change event arrives after applyEdit resolves', async () => {
    const { sync, posted } = setup('a', { events: 'after' });
    await sync.handleMessage({
      type: 'edit',
      id: 1,
      baseVersion: 1,
      changes: [insertAt(0, 1, 'b')],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(posted).toEqual([{ type: 'ack', id: 1, version: 2 }]);
  });

  it('sends outside changes as a replace without an id', () => {
    const { posted, outsideChange } = setup();
    outsideChange('changed');
    expect(posted).toEqual([{ type: 'replace', text: 'changed', version: 2 }]);
  });

  it('rejects an edit based on an old version without applying it', async () => {
    const { sync, posted, outsideChange, applyEdit } = setup('x');
    outsideChange('y');
    posted.length = 0;
    await sync.handleMessage({
      type: 'edit',
      id: 3,
      baseVersion: 1,
      changes: [insertAt(0, 0, 'z')],
    });
    expect(applyEdit).not.toHaveBeenCalled();
    expect(posted).toEqual([{ type: 'replace', text: 'y', version: 2, id: 3 }]);
  });

  it('answers a refused edit with a replace', async () => {
    const { sync, posted, setResult } = setup('x');
    setResult(false);
    await sync.handleMessage({
      type: 'edit',
      id: 4,
      baseVersion: 1,
      changes: [insertAt(0, 0, 'z')],
    });
    expect(posted).toEqual([{ type: 'replace', text: 'x', version: 1, id: 4 }]);
  });

  it('answers a failed edit with a replace', async () => {
    const { sync, posted, setResult } = setup('x');
    setResult('throw');
    await sync.handleMessage({
      type: 'edit',
      id: 5,
      baseVersion: 1,
      changes: [insertAt(0, 0, 'z')],
    });
    expect(posted).toEqual([{ type: 'replace', text: 'x', version: 1, id: 5 }]);
  });

  it('acknowledges an edit that changes nothing', async () => {
    const { sync, posted } = setup('x');
    const sameText: TextChange = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      text: 'x',
    };
    await sync.handleMessage({ type: 'edit', id: 6, baseVersion: 1, changes: [sameText] });
    expect(posted).toEqual([{ type: 'ack', id: 6, version: 1 }]);
  });

  it('applies edits one after another, in order', async () => {
    const { sync, posted, doc } = setup('');
    await Promise.all([
      sync.handleMessage({ type: 'edit', id: 1, baseVersion: 1, changes: [insertAt(0, 0, 'a')] }),
      sync.handleMessage({ type: 'edit', id: 2, baseVersion: 2, changes: [insertAt(0, 1, 'b')] }),
    ]);
    expect(doc.text).toBe('ab');
    expect(posted).toEqual([
      { type: 'ack', id: 1, version: 2 },
      { type: 'ack', id: 2, version: 3 },
    ]);
  });

  it('sends a replace if it acknowledged someone else’s change and its own edit failed', async () => {
    const { sync, posted, doc, host } = setup('a');
    host.applyEdit = async () => {
      // Another change lands while our edit is being applied, and ours is then refused.
      doc.text = 'other';
      doc.version++;
      sync.onDocumentChanged();
      return false;
    };
    await sync.handleMessage({
      type: 'edit',
      id: 9,
      baseVersion: 1,
      changes: [insertAt(0, 0, 'z')],
    });
    expect(posted).toEqual([
      { type: 'ack', id: 9, version: 2 },
      { type: 'replace', text: 'other', version: 2 },
    ]);
  });

  it('passes undo and redo to VS Code', async () => {
    const { sync, host } = setup();
    await sync.handleMessage({ type: 'undo' });
    await sync.handleMessage({ type: 'redo' });
    expect(host.executeCommand).toHaveBeenNthCalledWith(1, 'undo');
    expect(host.executeCommand).toHaveBeenNthCalledWith(2, 'redo');
  });
});
