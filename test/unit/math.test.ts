import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { collectBlocks, type BlockItem } from '../../webview/livePreview/blocks';
import { collectInline } from '../../webview/livePreview/inline';
import { mathExtension } from '../../webview/livePreview/math';

/** Builds a state from text where `@` marks the cursor; the `@` is removed from the document. */
function stateWithCursor(marked: string): EditorState {
  const at = marked.indexOf('@');
  const doc = marked.replace('@', '');
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(at < 0 ? doc.length : at),
    extensions: [markdown({ base: markdownLanguage, extensions: [mathExtension] })],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

/** The math nodes in the text, as [name, text]. */
function mathNodes(text: string): [string, string][] {
  const state = stateWithCursor(text);
  const found: [string, string][] = [];
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name === 'InlineMath' || ref.name === 'BlockMath') {
        found.push([ref.name, state.doc.sliceString(ref.from, ref.to)]);
      }
    },
  });
  return found;
}

const blocks = (marked: string): BlockItem[] => collectBlocks(stateWithCursor(marked), '');

describe('math syntax', () => {
  it('parses inline math', () => {
    expect(mathNodes('Energy $E = mc^2$ here')).toEqual([['InlineMath', '$E = mc^2$']]);
    expect(mathNodes('Two $a$ and $b$.')).toEqual([
      ['InlineMath', '$a$'],
      ['InlineMath', '$b$'],
    ]);
  });

  it('parses $$ inside a paragraph as inline math', () => {
    expect(mathNodes('See $$x + y$$ now')).toEqual([['InlineMath', '$$x + y$$']]);
  });

  it('does not treat prices as math', () => {
    expect(mathNodes('It costs $5 and then $6 more')).toEqual([]);
    expect(mathNodes('A lone $ sign')).toEqual([]);
    expect(mathNodes('Spaces $ x $ inside')).toEqual([]);
  });

  it('skips escaped dollars, and dollars inside code', () => {
    expect(mathNodes('Cost \\$5 and \\$6')).toEqual([]);
    expect(mathNodes('Code `$a$` here')).toEqual([]);
  });

  it('allows an escaped dollar inside math', () => {
    expect(mathNodes('$a \\$ b$')).toEqual([['InlineMath', '$a \\$ b$']]);
  });

  it('parses a $$ block over several lines', () => {
    expect(mathNodes('Before\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nAfter')).toEqual([
      ['BlockMath', '$$\n\\int_0^1 x\\,dx\n$$'],
    ]);
  });

  it('parses a $$ block on one line, and one with no closing $$', () => {
    expect(mathNodes('$$ x^2 $$\n\ntext')).toEqual([['BlockMath', '$$ x^2 $$']]);
    expect(mathNodes('$$\nx + y')).toEqual([['BlockMath', '$$\nx + y']]);
  });
});

describe('math and diagrams in the block preview', () => {
  it('draws inline math until the cursor is in it', () => {
    expect(blocks('a $x^2$ b\n\n^c')).toEqual([
      { type: 'math', from: 2, to: 7, tex: 'x^2', display: false },
    ]);
    expect(blocks('a $x^@2$ b')).toEqual([]);
  });

  it('draws a block formula from $$ and from a math fence', () => {
    expect(blocks('$$\na+b\n$$\n\n^z')).toEqual([
      { type: 'math', from: 0, to: 9, tex: 'a+b', display: true },
    ]);
    expect(blocks('```math\na+b\n```\n\n^z')).toEqual([
      { type: 'math', from: 0, to: 15, tex: 'a+b', display: true },
    ]);
  });

  it('draws a mermaid fence as a diagram', () => {
    expect(blocks('```mermaid\ngraph TD\n  A-->B\n```\n\n^z')).toEqual([
      { type: 'mermaid', from: 0, to: 31, source: 'graph TD\n  A-->B' },
    ]);
  });

  it('shows the source of a block while the cursor is in it', () => {
    expect(blocks('```mermaid\ngraph @TD\n```')).toEqual([]);
    expect(blocks('$$\na@+b\n$$')).toEqual([]);
  });

  it('leaves other fences alone', () => {
    expect(blocks('```js\nconst a = 1;\n```\n\n^z')).toEqual([]);
  });
});

describe('math in the inline preview', () => {
  it('shows math source in code font and as a code block, and styles nothing inside', () => {
    const state = stateWithCursor('a $x_1 * y_2$ b @\n\n$$\n*z*\n$$');
    const items = collectInline(state, 0, state.doc.length);
    expect(items.filter((i) => i.type === 'hide')).toEqual([]);
    expect(items.filter((i) => i.type === 'mark').map((m) => m.className)).toEqual([
      'cm-md-mathsrc',
    ]);
    expect(items.filter((i) => i.type === 'line').length).toBe(3);
  });
});
