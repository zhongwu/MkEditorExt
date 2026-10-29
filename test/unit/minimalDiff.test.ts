// The main promise (PLAN.md §3.6): an edit changes only what it has to. For every file in
// test/corpus, every command and widget action is run at many places, the result is sent through
// the same path a real edit takes (CodeMirror change, then line/character change, then applied
// to the file's own text), and the lines that differ from the original are checked.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import {
  insertLink,
  insertTable,
  setHeading,
  toggleLineKind,
  toggleTask,
  toggleWrap,
} from '../../webview/commands';
import { collectBlocks } from '../../webview/livePreview/blocks';
import { cellChange } from '../../webview/livePreview/tableEdit';
import { checkboxChange } from '../../webview/livePreview/widgets';
import { normalizeLineEndings, toTextChanges } from '../../webview/sync';
import { applyTextChanges } from './helpers';

const corpusDir = join(__dirname, '..', 'corpus');
const files = readdirSync(corpusDir).filter((name) => name.endsWith('.md'));

const COMMANDS: Record<string, (state: EditorState) => TransactionSpec> = {
  bold: (s) => toggleWrap(s, '**'),
  italic: (s) => toggleWrap(s, '*'),
  strike: (s) => toggleWrap(s, '~~'),
  code: (s) => toggleWrap(s, '`'),
  h1: (s) => setHeading(s, 1),
  h2: (s) => setHeading(s, 2),
  h3: (s) => setHeading(s, 3),
  bullet: (s) => toggleLineKind(s, 'bullet'),
  number: (s) => toggleLineKind(s, 'number'),
  task: (s) => toggleLineKind(s, 'task'),
  toggleTask: toggleTask,
  quote: (s) => toggleLineKind(s, 'quote'),
  link: insertLink,
  table: insertTable,
};

const lineBreak = /\r\n|\n/;

/**
 * The lines of `before` that `after` replaced: [from, to) counted from zero. A pure insertion
 * has from === to. Found by trimming the lines that are the same at the start and the end.
 */
function changedLines(before: string, after: string): { from: number; to: number } {
  const a = before.split(lineBreak);
  const b = after.split(lineBreak);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { from: start, to: endA };
}

/** Selections to try in a document: cursors, a word, and a block of lines, spread over it. */
function selections(doc: EditorState['doc']): EditorSelection[] {
  const out: EditorSelection[] = [];
  const step = Math.max(1, Math.floor(doc.lines / 40));
  for (let n = 1; n <= doc.lines; n += step) {
    const line = doc.line(n);
    out.push(EditorSelection.single(line.from));
    out.push(EditorSelection.single(line.from + Math.floor(line.length / 2)));
    out.push(EditorSelection.single(line.to));
    const word = /\w+/.exec(line.text);
    if (word)
      out.push(
        EditorSelection.single(line.from + word.index, line.from + word.index + word[0].length),
      );
    const last = doc.line(Math.min(doc.lines, n + 2));
    out.push(EditorSelection.single(line.from, last.to));
  }
  return out;
}

describe.each(files)('%s', (name) => {
  const original = readFileSync(join(corpusDir, name), 'utf8');
  const normalized = normalizeLineEndings(original);
  const crlf = original.includes('\r\n');

  /** What the file would contain if this transaction were applied to it by VS Code. */
  const sentToFile = (state: EditorState, spec: TransactionSpec): string | null => {
    const tr = state.update(spec);
    if (!tr.docChanged) return null;
    return applyTextChanges(original, toTextChanges(tr.changes, state.doc));
  };

  it('changes only the selected lines for every formatting command', () => {
    const doc = EditorState.create({ doc: normalized }).doc;
    let checked = 0;
    for (const selection of selections(doc)) {
      const state = EditorState.create({ doc: normalized, selection });
      const first = doc.lineAt(selection.main.from).number - 1;
      const last = doc.lineAt(selection.main.to).number - 1;
      for (const [command, run] of Object.entries(COMMANDS)) {
        const result = sentToFile(state, run(state));
        if (result === null) continue;
        const changed = changedLines(original, result);
        const where = `${command} at ${selection.main.from}-${selection.main.to}`;
        expect(changed.from, where).toBeGreaterThanOrEqual(first);
        // Text added between lines may be reported a few blank lines later: the same result.
        const originalLines = original.split(lineBreak);
        const slid =
          changed.from === changed.to &&
          originalLines.slice(last + 1, changed.from).every((line) => line.trim() === '');
        expect(changed.to <= last + 1 || slid, where).toBe(true);
        if (crlf) expect(result.replace(/\r\n/g, ''), where).not.toMatch(/[\r\n]/);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('adds or removes only the marker characters when wrapping text', () => {
    const doc = EditorState.create({ doc: normalized }).doc;
    for (const selection of selections(doc)) {
      const state = EditorState.create({ doc: normalized, selection });
      for (const [command, marker] of [
        ['bold', '**'],
        ['italic', '*'],
        ['strike', '~~'],
        ['code', '`'],
      ] as const) {
        const result = sentToFile(state, toggleWrap(state, marker));
        if (result === null) continue;
        const delta = Math.abs(result.length - original.length);
        expect(delta % marker.length, `${command} at ${selection.main.from}`).toBe(0);
        expect(delta, `${command} at ${selection.main.from}`).toBeLessThanOrEqual(
          2 * marker.length,
        );
      }
    }
  });

  it('turns every task on and off with a one-character edit', () => {
    const state = EditorState.create({
      doc: normalized,
      extensions: [markdown({ base: markdownLanguage })],
      selection: EditorSelection.single(normalized.length),
    });
    ensureSyntaxTree(state, normalized.length, 5000);
    const boxes = collectBlocks(state, '').filter((item) => item.type === 'checkbox');
    for (const box of boxes) {
      if (box.type !== 'checkbox') continue;
      const spec = { changes: checkboxChange(box.from, box.offset, box.checked) };
      const result = sentToFile(state, spec);
      expect(result, `task at ${box.from}`).not.toBeNull();
      expect(result!.length).toBe(original.length);
      let different = 0;
      for (let i = 0; i < original.length; i++) if (original[i] !== result![i]) different++;
      expect(different, `task at ${box.from}`).toBe(1);
    }
  });

  it('edits only the one cell of a table that was typed in', () => {
    const state = EditorState.create({
      doc: normalized,
      extensions: [markdown({ base: markdownLanguage })],
      selection: EditorSelection.single(normalized.length),
    });
    ensureSyntaxTree(state, normalized.length, 5000);
    for (const item of collectBlocks(state, '')) {
      if (item.type !== 'table') continue;
      item.data.ranges.flat().forEach((cell, index) => {
        const range = { from: item.from + cell.from, to: item.from + cell.to };
        const shown = normalized.slice(range.from, range.to);
        for (const typed of ['X', 'a|b', 'two words', '']) {
          const change = cellChange(range, shown, typed);
          if (!change) continue;
          const result = sentToFile(state, { changes: change });
          const line = state.doc.lineAt(range.from).number - 1;
          const where = `table at ${item.from}, cell ${index}, typed ${JSON.stringify(typed)}`;
          expect(changedLines(original, result!), where).toEqual({ from: line, to: line + 1 });
          if (crlf) expect(result!.replace(/\r\n/g, ''), where).not.toMatch(/[\r\n]/);
        }
      });
    }
  });
});
