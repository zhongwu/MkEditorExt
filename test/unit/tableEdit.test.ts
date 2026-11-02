import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { collectBlocks } from '../../webview/livePreview/blocks';
import { cellChange, cellRanges } from '../../webview/livePreview/tableEdit';

function cells(line: string, from = 0): string[] {
  return cellRanges(from, line).map((r) => line.slice(r.from - from, r.to - from));
}

describe('cellRanges', () => {
  it('splits a row with outer pipes', () => {
    expect(cells('| a | bb |')).toEqual([' a ', ' bb ']);
  });

  it('splits a row without outer pipes', () => {
    expect(cells('a | b')).toEqual(['a ', ' b']);
  });

  it('keeps empty cells', () => {
    expect(cells('|  | x |  |')).toEqual(['  ', ' x ', '  ']);
  });

  it('does not split at an escaped pipe', () => {
    expect(cells('| a \\| b | c |')).toEqual([' a \\| b ', ' c ']);
  });

  it('adds the line offset to every range', () => {
    expect(cellRanges(10, '| a |')).toEqual([{ from: 11, to: 14 }]);
  });
});

describe('cellChange', () => {
  const range = { from: 4, to: 9 };

  it('replaces only the cell, with one space of padding each side', () => {
    expect(cellChange(range, ' old ', 'new')).toEqual({ from: 4, to: 9, insert: ' new ' });
  });

  it('changes nothing when the text is the same', () => {
    expect(cellChange(range, '  old', 'old  ')).toBeNull();
  });

  it('escapes a typed pipe and turns line breaks into spaces', () => {
    expect(cellChange(range, ' a ', 'x | y\nz')?.insert).toBe(' x \\| y z ');
    expect(cellChange(range, ' a ', 'x \\| y')?.insert).toBe(' x \\| y ');
  });

  it('leaves a blank cell as a single space', () => {
    expect(cellChange(range, ' a ', '   ')?.insert).toBe(' ');
  });
});

describe('table data ranges', () => {
  const doc = '| H1 | H2 |\n| --- | --- |\n| a | b |\n| c |\n\n';

  it('gives the header and each row the ranges of their cells', () => {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdown({ base: markdownLanguage })],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    const table = collectBlocks(state, '').find((item) => item.type === 'table');
    if (table?.type !== 'table') throw new Error('no table');
    const text = (r: { from: number; to: number }) =>
      doc.slice(table.from + r.from, table.from + r.to);
    expect(table.data.ranges.map((row) => row.map(text))).toEqual([
      [' H1 ', ' H2 '],
      [' a ', ' b '],
      [' c '],
    ]);
  });
});

describe('tables in list items', () => {
  const tables = (doc: string) => {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdown({ base: markdownLanguage })],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    return collectBlocks(state, '').flatMap((item) => (item.type === 'table' ? [item] : []));
  };

  it('draws a table in a (nested) list item from the start of its line, indented', () => {
    const doc = '- a\n  - b\n\n    | H1 | H2 |\n    | --- | --- |\n    | x | y |\n\nend\n';
    const [table] = tables(doc);
    const start = doc.indexOf('    | H1');
    expect(table).toMatchObject({ from: start, indent: 4 });
    const text = (r: { from: number; to: number }) =>
      doc.slice(table.from + r.from, table.from + r.to);
    expect(table.data.ranges.map((row) => row.map(text))).toEqual([
      [' H1 ', ' H2 '],
      [' x ', ' y '],
    ]);
  });

  it('draws a table right under the item text', () => {
    const doc = '1. Numbered\n   | p | q |\n   |---|---|\n   | 3 | 4 |\n\nend\n';
    expect(tables(doc)).toMatchObject([{ from: doc.indexOf('   | p'), indent: 3 }]);
  });

  it('leaves a table in a quote as text', () => {
    expect(tables('> | a | b |\n> |---|---|\n> | 1 | 2 |\n\nend\n')).toEqual([]);
  });
});
