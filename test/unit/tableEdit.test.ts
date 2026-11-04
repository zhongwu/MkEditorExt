import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { collectBlocks } from '../../webview/livePreview/blocks';
import type { EditorView } from '@codemirror/view';
import { insertBoxAtCursor } from '../../webview/livePreview/widgets';
import { cellChange, cellRanges, nextBox } from '../../webview/livePreview/tableEdit';

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

  it('turns a typed [ ] and [x] into ☐ and ☑, anywhere in the cell', () => {
    expect(cellChange(range, ' a ', '[ ]')?.insert).toBe(' ☐ ');
    expect(cellChange(range, ' a ', ' [x] ')?.insert).toBe(' ☑ ');
    expect(cellChange(range, ' a ', '[X]')?.insert).toBe(' ☑ ');
    expect(cellChange(range, ' a ', 'do [x] this, [ ] that')?.insert).toBe(' do ☑ this, ☐ that ');
  });

  it('leaves [ ] in code and after a backslash alone', () => {
    expect(cellChange(range, ' a ', 'use `[ ]` here')?.insert).toBe(' use `[ ]` here ');
    expect(cellChange(range, ' a ', 'not \\[ ] a box')?.insert).toBe(' not \\[ ] a box ');
    expect(cellChange(range, ' a ', '`[x]` and [x]')?.insert).toBe(' `[x]` and ☑ ');
  });

  it('converts only a cell that was changed, and changes nothing if the result is the same', () => {
    expect(cellChange(range, ' [ ] ', '[ ]')).toBeNull();
    expect(cellChange(range, ' ☐ ', '[ ]')).toBeNull();
    expect(cellChange(range, ' [ ] x ', '[ ] y')?.insert).toBe(' ☐ y ');
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

describe('task boxes in table cells', () => {
  const cellOf = (doc: string, row: number, col: number) => {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdown({ base: markdownLanguage })],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    const table = collectBlocks(state, '').find((item) => item.type === 'table');
    if (table?.type !== 'table') throw new Error('no table');
    return { table, spans: (row === 0 ? table.data.header : table.data.rows[row - 1])[col] };
  };
  it('has three states: ☐ open, ☑ done and ☒ crossed, and a click goes round them', () => {
    const three = '| A | B | C |\n|---|---|---|\n| ☐ | ☑ | ☒ |\n\nend\n';
    expect([0, 1, 2].map((col) => cellOf(three, 1, col).spans[0])).toMatchObject([
      { type: 'task', state: 'open' },
      { type: 'task', state: 'done' },
      { type: 'task', state: 'crossed' },
    ]);
    expect(nextBox('☐')).toBe('☑');
    expect(nextBox('☑')).toBe('☒');
    expect(nextBox('☒')).toBe('☐');
    expect(nextBox('x')).toBe('☐');
  });

  describe('the characters ☐ and ☑', () => {
    // The last cell has ☑ in its emoji form: the character followed by U+FE0F.
    const emoji = '☑' + String.fromCharCode(0xfe0f);
    const glyphs = `| A | B | C |\n|---|---|---|\n| ☐ | go ☑ now | ${emoji} \`☐\` ✅ |\n\nend\n`;

    it('are boxes anywhere in a cell, not only when they are the whole cell', () => {
      expect(cellOf(glyphs, 1, 0).spans).toMatchObject([
        { type: 'task', state: 'open', length: 1 },
      ]);
      expect(cellOf(glyphs, 1, 1).spans).toMatchObject([
        { type: 'text', text: 'go ' },
        { type: 'task', state: 'done' },
        { type: 'text', text: ' now' },
      ]);
    });

    it('take the emoji form with them, so a click replaces all of it', () => {
      const { table, spans } = cellOf(glyphs, 1, 2);
      expect(spans[0]).toMatchObject({ type: 'task', state: 'done', length: 2 });
      const box = spans[0];
      if (box.type !== 'task') throw new Error('no box');
      expect(glyphs.slice(table.from + box.at, table.from + box.at + box.length)).toBe(emoji);
    });

    it('are left alone in code, and so are other symbols', () => {
      const spans = cellOf(glyphs, 1, 2).spans;
      expect(spans.find((span) => span.type === 'code')).toMatchObject({
        children: [{ type: 'text', text: '☐' }],
      });
      expect(spans.at(-1)).toMatchObject({ type: 'text', text: ' ✅' });
    });

    it('are the only boxes: [ ] and [x] in a file stay text, and [x] is not italic', () => {
      const brackets = '| A | B |\n|---|---|\n| [ ] one | [x] two |\n\nend\n';
      const plain = (col: number) => {
        const { spans } = cellOf(brackets, 1, col);
        expect(spans.every((span) => span.type === 'text')).toBe(true);
        return spans.map((span) => (span.type === 'text' ? span.text : '')).join('');
      };
      expect(plain(0)).toBe('[ ] one');
      expect(plain(1)).toBe('[x] two');
    });
  });
});

describe('insertBoxAtCursor (the toolbar buttons with a table shown as source)', () => {
  const text = 'intro\n\n| A | B |\n|---|---|\n| one | two |\n\nend\n';
  /** Runs the function with the cursor at `at` (of `text`); returns what it did and the new text. */
  const run = (at: number, box = '☐') => {
    let state = EditorState.create({
      doc: text,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage })],
    });
    ensureSyntaxTree(state, text.length, 5000);
    const view = {
      get state() {
        return state;
      },
      dispatch: (spec: Parameters<EditorState['update']>[0]) => {
        state = state.update(spec).state;
      },
      focus: () => {},
    };
    const done = insertBoxAtCursor(view as unknown as EditorView, box);
    return { done, doc: state.doc.toString() };
  };

  it('types the box at the cursor in a cell, with a space where it touches a word', () => {
    // After "one" in the last row.
    expect(run(text.indexOf('one') + 3).doc).toContain('| one ☐ | two |');
    // Between "t" and "wo".
    expect(run(text.indexOf('two') + 1, '☑').doc).toContain('| t ☑ wo |');
  });

  it('puts the box in the first cell when the cursor is at the start of the table', () => {
    expect(run(text.indexOf('| A')).doc).toContain('| ☐ A | B |');
  });

  it('does nothing outside a table, or on the | --- | line', () => {
    expect(run(2).done).toBe(false);
    expect(run(text.indexOf('end')).done).toBe(false);
    expect(run(text.indexOf('|---') + 4).done).toBe(false);
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
