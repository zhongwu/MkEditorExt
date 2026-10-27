import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { collectBlocks, type BlockItem } from '../../webview/livePreview/blocks';
import { findFrontMatter } from '../../webview/livePreview/frontMatter';
import { resolveImageSrc } from '../../webview/livePreview/images';

const BASE = 'https://file.example/docs/';

/** Builds a state from text where `^` marks the cursor; the `^` is removed from the document. */
function stateWithCursor(marked: string): EditorState {
  const at = marked.indexOf('^');
  const doc = marked.replace('^', '');
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(at < 0 ? doc.length : at),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

function blocks(marked: string): BlockItem[] {
  return collectBlocks(stateWithCursor(marked), BASE);
}

const TABLE = '| A | B |\n| :-- | --: |\n| **x** | `y` |\n';

describe('resolveImageSrc', () => {
  it('loads web and data images as they are', () => {
    expect(resolveImageSrc('https://x.y/a.png', BASE)).toBe('https://x.y/a.png');
    expect(resolveImageSrc('data:image/png;base64,AAAA', BASE)).toBe('data:image/png;base64,AAAA');
  });

  it('resolves relative paths against the document folder', () => {
    expect(resolveImageSrc('img/a.png', BASE)).toBe('https://file.example/docs/img/a.png');
    expect(resolveImageSrc('../a b.png', BASE)).toBe('https://file.example/a%20b.png');
    expect(resolveImageSrc('<img/a.png>', BASE)).toBe('https://file.example/docs/img/a.png');
    expect(resolveImageSrc('img\\a.png', BASE)).toBe('https://file.example/docs/img/a.png');
  });

  it('refuses other schemes, absolute paths and empty values', () => {
    for (const src of ['file:///etc/passwd', 'javascript:x', 'C:\\a.png', '/a.png', '  ']) {
      expect(resolveImageSrc(src, BASE)).toBeUndefined();
    }
    expect(resolveImageSrc('a.png', '')).toBeUndefined();
  });
});

describe('collectBlocks', () => {
  it('draws a horizontal rule until the cursor is on it', () => {
    expect(blocks('a\n\n---\n\n|b')).toEqual([{ type: 'hr', from: 3, to: 6 }]);
    expect(blocks('a\n\n-^--\n\nb')).toEqual([]);
  });

  it('ignores a setext underline', () => {
    expect(blocks('Title\n-----\n\n|x')).toEqual([]);
  });

  it('draws a table with alignment and inline formatting', () => {
    const [table] = blocks(TABLE + '\n|after');
    expect(table).toMatchObject({ type: 'table', from: 0 });
    if (table.type !== 'table') throw new Error('not a table');
    expect(table.data.align).toEqual(['left', 'right']);
    expect(table.data.header).toEqual([
      [{ type: 'text', text: 'A' }],
      [{ type: 'text', text: 'B' }],
    ]);
    expect(table.data.rows).toEqual([
      [
        [{ type: 'strong', children: [{ type: 'text', text: 'x' }] }],
        [{ type: 'code', children: [{ type: 'text', text: 'y' }] }],
      ],
    ]);
  });

  it('shows the table source while the cursor is in it', () => {
    expect(blocks('| A | ^B |\n| - | - |\n| 1 | 2 |')).toEqual([]);
  });

  it('draws an image, or draws it below its source while the cursor is in it', () => {
    expect(blocks('x ![cat](cat.png) y\n\n|z')).toEqual([
      {
        type: 'image',
        from: 2,
        to: 17,
        src: 'https://file.example/docs/cat.png',
        alt: 'cat',
        revealed: false,
      },
    ]);
    expect(blocks('x ![cat](ca^t.png) y')).toEqual([
      {
        type: 'image',
        from: 19,
        to: 19,
        src: 'https://file.example/docs/cat.png',
        alt: 'cat',
        revealed: true,
      },
    ]);
  });

  it('leaves an image with a refused source as text', () => {
    expect(blocks('![x](file:///a.png)\n\n|z')).toEqual([]);
  });

  it('draws task checkboxes with the position of the character to toggle', () => {
    expect(blocks('- [ ] open\n- [x] done\n\n|z')).toEqual([
      { type: 'checkbox', from: 0, to: 5, checked: false, offset: 3 },
      { type: 'checkbox', from: 11, to: 16, checked: true, offset: 3 },
    ]);
  });

  it('shows the checkbox source while the cursor is on it', () => {
    expect(blocks('- [^ ] open')).toEqual([]);
  });

  it('draws front matter once, and not its dashes as rules', () => {
    const items = blocks('---\ntitle: "Hi"\ntags: a\n---\n\n---\n\n|z');
    expect(items).toEqual([
      {
        type: 'frontMatter',
        from: 0,
        to: 27,
        entries: [
          ['title', 'Hi'],
          ['tags', 'a'],
        ],
      },
      { type: 'hr', from: 29, to: 32 },
    ]);
  });
});

describe('findFrontMatter', () => {
  const find = (text: string) => findFrontMatter(EditorState.create({ doc: text }).doc);

  it('needs the block to start on the first line and be closed', () => {
    expect(find('---\na: 1\n---')).toMatchObject({ from: 0, to: 12 });
    expect(find('x\n---\na: 1\n---')).toBeUndefined();
    expect(find('---\na: 1\n')).toBeUndefined();
    expect(find('---')).toBeUndefined();
  });

  it('also accepts "..." as the closing line', () => {
    expect(find('---\na: 1\n...')).toMatchObject({ entries: [['a', '1']] });
  });
});
