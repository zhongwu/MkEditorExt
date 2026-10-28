import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import type { Decoration, DecorationSet } from '@codemirror/view';
import { blockPreview, collectBlocks, toBlockDecorations } from '../../webview/livePreview/blocks';
import { composingField, setComposing } from '../../webview/livePreview/composition';
import { footnoteExtension } from '../../webview/livePreview/footnotes';
import { mathExtension } from '../../webview/livePreview/math';

const BASE = 'https://file.example/docs/';

/** A small seeded random generator, so a failure can be repeated. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  '\n',
  '\n\n',
  ' ',
  '| a | b |\n| - | - |\n| 1 | 2 |\n',
  '```\n',
  '```js\n',
  '$$\n',
  '$x$',
  '---\n',
  '- [ ] task\n',
  '![alt](pic.png)',
  '# Heading\n',
  '**',
  '|',
  '> [!NOTE]\n',
];

function corpus(): string {
  const dir = join(__dirname, '..', 'corpus');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n'))
    .join('\n\n');
}

/** What a decoration set draws, up to `limit`, in a form that can be compared. */
function summary(set: DecorationSet, limit: number): string[] {
  const out: string[] = [];
  set.between(0, limit, (from, to, value: Decoration) => {
    if (from >= limit) return;
    const widget = value.spec.widget as { constructor: { name: string } } | undefined;
    // Widgets are rebuilt, so compare what they were made from.
    out.push(`${from}-${to} ${widget?.constructor.name} ${JSON.stringify(widget, replacer)}`);
  });
  return out;
}

const replacer = (_key: string, value: unknown) =>
  typeof value === 'function' ? undefined : value;

describe('the block field', () => {
  for (const seed of Array.from({ length: 24 }, (_, i) => i + 1)) {
    it(`matches a full rebuild after random edits, cursor moves and parsing (seed ${seed})`, () => {
      const next = random(seed);
      const field = blockPreview(BASE);
      const make = (doc: string) =>
        EditorState.create({
          doc,
          extensions: [
            markdown({ base: markdownLanguage, extensions: [mathExtension, footnoteExtension] }),
            field,
          ],
        });
      let state = make(`${corpus()}\n\n${corpus()}`);

      let what: string;
      for (let step = 0; step < 300; step++) {
        const length = state.doc.length;
        const roll = next();
        const pos = Math.floor(next() * (length + 1));
        if (roll < 0.4) {
          const to = Math.min(length, pos + Math.floor(next() * 6));
          const insert = PIECES[Math.floor(next() * PIECES.length)];
          what = `edit ${pos}-${to} -> ${JSON.stringify(insert)}`;
          state = state.update({ changes: { from: pos, to, insert } }).state;
        } else if (roll < 0.7) {
          const end = Math.min(length, pos + (next() < 0.3 ? Math.floor(next() * 200) : 0));
          what = `select ${pos}-${end}`;
          state = state.update({ selection: EditorSelection.range(pos, end) }).state;
        } else {
          what = `parse to ${pos + 3000}`;
          ensureSyntaxTree(state, Math.min(length, pos + 3000), 5000);
          state = state.update({}).state;
        }

        const parsed = Math.min(syntaxTree(state).length, state.doc.length);
        const expected = summary(toBlockDecorations(collectBlocks(state, BASE), BASE), parsed);
        const actual = summary(state.field(field).decorations, parsed);
        expect(actual, `seed ${seed}, step ${step}: ${what}`).toEqual(expected);
      }
    });
  }
});

describe('the block field during IME composition', () => {
  const doc = ['Intro', '', '| A | B |', '| - | - |', '| 1 | 2 |', '', 'End', ''].join('\n');
  const make = () => {
    const field = blockPreview(BASE);
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: [mathExtension, footnoteExtension] }),
        composingField,
        field,
      ],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    return { field, state: state.update({}).state };
  };
  const widgets = (state: EditorState, field: ReturnType<typeof blockPreview>) =>
    summary(state.field(field).decorations, state.doc.length).map((line) => line.split(' ')[1]);

  it('keeps what is drawn while composing, and catches up when it ends', () => {
    const { field, state: start } = make();
    expect(widgets(start, field)).toEqual(['TableWidget']);

    // The cursor moves into the table while composing: the widget stays until the end.
    let state = start.update({ effects: setComposing.of(true) }).state;
    state = state.update({ selection: EditorSelection.cursor(doc.indexOf('| 1')) }).state;
    expect(widgets(state, field)).toEqual(['TableWidget']);

    state = state.update({ effects: setComposing.of(false) }).state;
    expect(widgets(state, field)).toEqual([]);
  });

  it('moves the drawn widgets along with text typed above them', () => {
    const { field, state: start } = make();
    let state = start.update({ effects: setComposing.of(true) }).state;
    state = state.update({ changes: { from: 0, to: 0, insert: '你好' } }).state;
    const before = summary(state.field(field).decorations, state.doc.length)[0];
    expect(before).toMatch(/^9-/);
  });
});
