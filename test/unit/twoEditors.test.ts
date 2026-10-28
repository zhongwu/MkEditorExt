import { describe, expect, it } from 'vitest';
import { DocumentSync } from '../../src/DocumentSync';
import type { HostMessage, TextChange } from '../../src/protocol';
import { applyTextChanges } from './helpers';

/** One document shown in two editors, each with its own DocumentSync (PLAN.md Phase 6). */
function twoEditors(text: string) {
  const doc = {
    version: 1,
    text,
    getText() {
      return this.text;
    },
  };
  const syncs: DocumentSync[] = [];
  const posted: HostMessage[][] = [[], []];
  const make = (index: number) =>
    new DocumentSync(doc, {
      async applyEdit(changes: readonly TextChange[]) {
        const next = applyTextChanges(doc.text, changes);
        if (next !== doc.text) {
          doc.text = next;
          doc.version++;
          // VS Code tells every listener, so both editors hear about it.
          syncs.forEach((sync) => sync.onDocumentChanged());
        }
        return true;
      },
      post: (message) => posted[index].push(message),
      executeCommand: () => undefined,
    });
  syncs.push(make(0), make(1));
  return { doc, a: syncs[0], b: syncs[1], postedA: posted[0], postedB: posted[1] };
}

const insert = (character: number, text: string): TextChange => ({
  range: { start: { line: 0, character }, end: { line: 0, character } },
  text,
});

describe('the same document in two editors', () => {
  it('shows each editor the other one’s edit as a replace, and acknowledges its own', async () => {
    const { doc, a, b, postedA, postedB } = twoEditors('hello\n');
    await a.handleMessage({ type: 'ready' });
    await b.handleMessage({ type: 'ready' });

    await a.handleMessage({ type: 'edit', id: 1, baseVersion: 1, changes: [insert(5, '!')] });

    expect(doc.text).toBe('hello!\n');
    expect(postedA.at(-1)).toEqual({ type: 'ack', id: 1, version: 2 });
    expect(postedB.at(-1)).toEqual({ type: 'replace', text: 'hello!\n', version: 2 });
  });

  it('lets the second editor carry on from the replace it was sent', async () => {
    const { doc, a, b, postedA } = twoEditors('hello\n');
    await a.handleMessage({ type: 'edit', id: 1, baseVersion: 1, changes: [insert(5, '!')] });
    await b.handleMessage({ type: 'edit', id: 1, baseVersion: 2, changes: [insert(0, '>')] });

    expect(doc.text).toBe('>hello!\n');
    expect(postedA.at(-1)).toEqual({ type: 'replace', text: '>hello!\n', version: 3 });
  });

  it('sends the real text back to an editor that edited an out-of-date version', async () => {
    const { doc, a, b, postedA, postedB } = twoEditors('hello\n');
    // Both editors type at version 1; the second edit arrives after the first has landed.
    await a.handleMessage({ type: 'edit', id: 1, baseVersion: 1, changes: [insert(5, '!')] });
    await b.handleMessage({ type: 'edit', id: 1, baseVersion: 1, changes: [insert(0, '>')] });

    expect(doc.text).toBe('hello!\n');
    expect(postedB.at(-1)).toEqual({ type: 'replace', text: 'hello!\n', version: 2, id: 1 });
    expect(postedA.filter((m) => m.type === 'ack')).toHaveLength(1);
  });

  it('keeps \\r\\n line endings when a line break is typed', async () => {
    const { doc, a, postedA } = twoEditors('one\r\ntwo\r\n');
    const lineBreak: TextChange = {
      range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } },
      text: '\n',
    };
    await a.handleMessage({ type: 'edit', id: 1, baseVersion: 1, changes: [lineBreak] });
    expect(doc.text).toBe('one\r\n\r\ntwo\r\n');
    expect(postedA.at(-1)).toEqual({ type: 'ack', id: 1, version: 2 });
  });
});
