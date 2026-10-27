import { describe, expect, it } from 'vitest';
import { ChangeSet, EditorState, type ChangeSpec } from '@codemirror/state';
import { DocumentSync } from '../../src/DocumentSync';
import type { HostMessage, WebviewMessage } from '../../src/protocol';
import {
  WebviewSync,
  minimalChange,
  normalizeLineEndings,
  toTextChanges,
} from '../../webview/sync';
import { applyTextChanges, createRandom } from './helpers';

const SNIPPETS = ['a', 'é', '😀', '**', '\n', '- [ ] ', '# ', 'line\nbreak', ''];

/** Random non-overlapping changes against `state`'s document. */
function randomChanges(state: EditorState, random: ReturnType<typeof createRandom>): ChangeSpec[] {
  const length = state.doc.length;
  const count = 1 + random.int(3);
  const points = Array.from({ length: count * 2 }, () => random.int(length + 1)).sort(
    (a, b) => a - b,
  );
  const specs: ChangeSpec[] = [];
  for (let i = 0; i < points.length; i += 2) {
    const from = points[i];
    const to = random.int(3) === 0 ? points[i + 1] : from;
    specs.push({ from, to, insert: random.pick(SNIPPETS) });
  }
  return specs;
}

/** Text that keeps the file's line endings: no bare `\n` in a `\r\n` file. */
function hasOnlyCrlf(text: string): boolean {
  return !text.replace(/\r\n/g, '').includes('\n');
}

describe('toTextChanges', () => {
  it('uses line/character positions, so \\r\\n files line up', () => {
    const host = 'a\r\nbb\r\nc';
    const state = EditorState.create({ doc: host });
    const tr = state.update({ changes: { from: state.doc.line(3).from, insert: 'X' } });
    const changes = toTextChanges(tr.changes, state.doc);
    expect(changes).toEqual([
      { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } }, text: 'X' },
    ]);
    expect(applyTextChanges(host, changes)).toBe('a\r\nbb\r\nXc');
  });

  for (const eol of ['\n', '\r\n']) {
    it(`matches CodeMirror for random edits (${JSON.stringify(eol)} line endings)`, () => {
      const random = createRandom(eol.length * 1000);
      for (let run = 0; run < 300; run++) {
        let host = ['# Title', '', 'Some *text* 😀', '- [ ] task', ''].join(eol);
        const start = EditorState.create({ doc: host });
        // Two transactions composed, as the webview does with pending changes.
        const first = start.update({ changes: randomChanges(start, random) });
        const second = first.state.update({ changes: randomChanges(first.state, random) });
        const composed = first.changes.compose(second.changes);

        host = applyTextChanges(host, toTextChanges(composed, start.doc));
        expect(normalizeLineEndings(host)).toBe(second.state.doc.toString());
        if (eol === '\r\n') {
          expect(hasOnlyCrlf(host)).toBe(true);
        }
      }
    });
  }
});

describe('minimalChange', () => {
  it('returns null for equal text', () => {
    expect(minimalChange('abc', 'abc')).toBeNull();
  });

  it('replaces only the part that differs', () => {
    expect(minimalChange('hello world', 'hello brave world')).toEqual({
      from: 6,
      to: 6,
      insert: 'brave ',
    });
    expect(minimalChange('abcdef', 'abXYef')).toEqual({ from: 2, to: 4, insert: 'XY' });
  });

  it('always produces the new text', () => {
    const random = createRandom(42);
    const alphabet = ['a', 'b', '\n', '😀'];
    const word = () => Array.from({ length: random.int(8) }, () => random.pick(alphabet)).join('');
    for (let run = 0; run < 500; run++) {
      const oldText = word();
      const newText = word();
      const change = minimalChange(oldText, newText);
      const result = change
        ? oldText.slice(0, change.from) + change.insert + oldText.slice(change.to)
        : oldText;
      expect(result).toBe(newText);
    }
  });

  it('keeps the cursor in place when text elsewhere changes', () => {
    const state = EditorState.create({ doc: 'one\ntwo\nthree', selection: { anchor: 5 } });
    const change = minimalChange(state.doc.toString(), 'one\ntwo\nthree, four')!;
    const next = state.update({ changes: change }).state;
    expect(next.selection.main.head).toBe(5);
  });
});

describe('WebviewSync', () => {
  function setup(version = 1) {
    const sent: WebviewMessage[] = [];
    const sync = new WebviewSync((m) => sent.push(m));
    sync.reset(version);
    let state = EditorState.create({ doc: 'abc' });
    const type = (insert: string) => {
      const tr = state.update({ changes: { from: state.doc.length, insert } });
      sync.localChange(tr.changes, state.doc);
      state = tr.state;
    };
    const receive = (message: HostMessage) =>
      sync.receive(message, (text) => {
        state = state.update({ changes: { from: 0, to: state.doc.length, insert: text } }).state;
      });
    return { sync, sent, type, receive, text: () => state.doc.toString() };
  }

  it('sends the first change immediately', () => {
    const { sent, type } = setup(5);
    type('d');
    expect(sent).toEqual([
      {
        type: 'edit',
        id: 1,
        baseVersion: 5,
        changes: [
          {
            range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } },
            text: 'd',
          },
        ],
      },
    ]);
  });

  it('holds changes while an edit is in flight and sends them combined after the ack', () => {
    const { sent, type, receive } = setup(1);
    type('d');
    type('e');
    type('f');
    expect(sent).toHaveLength(1);
    expect(receive({ type: 'ack', id: 1, version: 2 })).toBe(false);
    expect(sent).toHaveLength(2);
    const second = sent[1] as Extract<WebviewMessage, { type: 'edit' }>;
    expect(second.baseVersion).toBe(2);
    expect(applyTextChanges('abcd', second.changes)).toBe('abcdef');
  });

  it('ignores an ack for an edit that is not in flight', () => {
    const { sent, type, receive } = setup(1);
    type('d');
    type('e');
    expect(receive({ type: 'ack', id: 99, version: 2 })).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('stops waiting when its edit is answered with a replace', () => {
    const { sent, type, receive, text } = setup(1);
    type('d');
    receive({ type: 'replace', text: 'xyz', version: 4, id: 1 });
    expect(text()).toBe('xyz');
    type('!');
    expect(sent).toHaveLength(2);
    expect((sent[1] as Extract<WebviewMessage, { type: 'edit' }>).baseVersion).toBe(4);
  });

  it('asks for a resync if its edit lands after an outside replace', () => {
    const { type, receive } = setup(1);
    type('d');
    receive({ type: 'replace', text: 'outside', version: 2 });
    expect(receive({ type: 'ack', id: 1, version: 3 })).toBe(true);
  });

  it('normalizes line endings from the host', () => {
    const { receive, text } = setup(1);
    receive({ type: 'replace', text: 'a\r\nb', version: 2 });
    expect(text()).toBe('a\nb');
  });
});

describe('host and webview together', () => {
  /**
   * Runs both halves against a fake document with messages delivered in random order,
   * plus outside changes. Keystrokes may be dropped in a conflict (PLAN.md §3.4), but once
   * all messages are delivered both sides must hold the same text.
   */
  for (let seed = 1; seed <= 50; seed++) {
    it(`always ends with both sides holding the same text (seed ${seed})`, async () => {
      const random = createRandom(seed);
      const eol: '\n' | '\r\n' = seed % 2 ? '\r\n' : '\n';
      const doc = { text: ['# Notes', '', '- [ ] one', 'two'].join(eol), version: 1 };
      const toHost: WebviewMessage[] = [];
      const toWebview: HostMessage[] = [];

      const host = new DocumentSync(
        {
          getText: () => doc.text,
          get version() {
            return doc.version;
          },
        },
        {
          applyEdit: async (changes) => {
            const next = applyTextChanges(doc.text, changes, eol);
            if (next !== doc.text) {
              doc.text = next;
              doc.version++;
              host.onDocumentChanged();
            }
            return true;
          },
          post: (m) => toWebview.push(m),
          executeCommand: () => undefined,
        },
      );

      let state = EditorState.create({ doc: '' });
      const webview = new WebviewSync((m) => toHost.push(m));
      const setText = (text: string) => {
        const change = minimalChange(state.doc.toString(), text);
        if (change) {
          state = state.update({ changes: change }).state;
        }
      };
      const deliverToWebview = () => {
        const message = toWebview.shift()!;
        if (webview.receive(message, setText)) {
          toHost.push({ type: 'ready' });
        }
      };
      const deliverToHost = () => host.handleMessage(toHost.shift()!);

      await host.handleMessage({ type: 'ready' });
      deliverToWebview();

      for (let step = 0; step < 400; step++) {
        const action = random.int(10);
        if (action < 4) {
          const tr = state.update({ changes: randomChanges(state, random) });
          webview.localChange(tr.changes as ChangeSet, state.doc);
          state = tr.state;
        } else if (action < 6 && toHost.length) {
          await deliverToHost();
        } else if (action < 8 && toWebview.length) {
          deliverToWebview();
        } else if (action === 8) {
          // Outside change, e.g. git checkout or a formatter.
          doc.text = applyTextChanges(
            doc.text,
            [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                text: random.pick(['>', 'x', 'new\n']),
              },
            ],
            eol,
          );
          doc.version++;
          host.onDocumentChanged();
        }
      }

      while (toHost.length || toWebview.length) {
        if (toHost.length) {
          await deliverToHost();
        }
        if (toWebview.length) {
          deliverToWebview();
        }
      }

      expect(state.doc.toString()).toBe(normalizeLineEndings(doc.text));
      if (eol === '\r\n') {
        expect(hasOnlyCrlf(doc.text)).toBe(true);
      }
    });
  }
});
