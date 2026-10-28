import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { collectBlocks, renderHtmlFacet } from '../../webview/livePreview/blocks';
import { footnoteDefinitions, footnoteExtension } from '../../webview/livePreview/footnotes';
import { collectInline, type InlineItem } from '../../webview/livePreview/inline';

/** Builds a state from text where `@` marks the cursor; the `@` is removed from the document. */
function stateWithCursor(marked: string, extra: Extension[] = []): EditorState {
  const at = marked.indexOf('@');
  const doc = marked.replace('@', '');
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(at < 0 ? doc.length : at),
    extensions: [markdown({ base: markdownLanguage, extensions: [footnoteExtension] }), ...extra],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

function inline(marked: string): InlineItem[] {
  const state = stateWithCursor(marked);
  return collectInline(state, 0, state.doc.length);
}

describe('GitHub alerts', () => {
  it('marks every line of the quote and draws the title in place of [!NOTE]', () => {
    const items = inline('> [!WARNING]\n> Careful here.\n\n@');
    expect(items.filter((i) => i.type === 'alert')).toEqual([
      { type: 'alert', from: 2, to: 12, kind: 'warning' },
    ]);
    const lines = items.filter((i) => i.type === 'line').map((l) => [l.pos, l.className]);
    expect(lines).toContainEqual([0, 'cm-md-alert cm-md-alert-warning']);
    expect(lines).toContainEqual([13, 'cm-md-alert cm-md-alert-warning']);
  });

  it('shows the [!NOTE] source while the cursor is on that line', () => {
    const items = inline('> [!NO@TE]\n> text');
    expect(items.filter((i) => i.type === 'alert')).toEqual([]);
    expect(items.some((i) => i.type === 'line' && i.className.includes('cm-md-alert-note'))).toBe(
      true,
    );
  });

  it('is case-insensitive, and leaves ordinary quotes and other text on the first line alone', () => {
    expect(inline('> [!tip]\n> x\n\n@').some((i) => i.type === 'alert')).toBe(true);
    expect(inline('> [!NOTE] extra\n\n@').some((i) => i.type === 'alert')).toBe(false);
    expect(inline('> [!OTHER]\n\n@').some((i) => i.type === 'alert')).toBe(false);
    expect(inline('> plain quote\n\n@').some((i) => i.type === 'alert')).toBe(false);
  });
});

describe('footnotes', () => {
  const DOC =
    'Text[^1] and more[^long-name].\n\n[^1]: The first note.\n[^long-name]: A longer\n    note.\n';

  it('shows the label as a superscript with the definition as its tooltip', () => {
    const items = inline(DOC + '@');
    const refs = items.filter((i) => i.type === 'mark' && i.className === 'cm-md-footnote-ref');
    expect(refs).toEqual([
      {
        type: 'mark',
        from: 6,
        to: 7,
        className: 'cm-md-footnote-ref',
        title: 'The first note.',
      },
      {
        type: 'mark',
        from: 19,
        to: 28,
        className: 'cm-md-footnote-ref',
        title: 'A longer note.',
      },
    ]);
    const hidden = items.filter((i) => i.type === 'hide').map((h) => [h.from, h.to]);
    expect(hidden).toEqual(
      expect.arrayContaining([
        [4, 6],
        [7, 8],
      ]),
    );
  });

  it('shows the source of a reference while the cursor is in it', () => {
    const items = inline('Text[^@1] here\n\n[^1]: note\n');
    expect(items.filter((i) => i.type === 'hide')).toEqual([]);
  });

  it('says so when a reference has no definition', () => {
    const [ref] = inline('Text[^9] here\n\n@').filter(
      (i) => i.type === 'mark' && i.className === 'cm-md-footnote-ref',
    );
    expect(ref).toMatchObject({ title: 'No definition found for this footnote' });
  });

  it('styles the label of each definition, but not inside code', () => {
    const labels = inline(DOC + '@')
      .filter((i) => i.type === 'mark' && i.className === 'cm-md-footnote-label')
      .map((i) => (i.type === 'mark' ? [i.from, i.to] : []));
    expect(labels).toEqual([
      [32, 37],
      [54, 67],
    ]);
    const inCode = inline('```\n[^1]: not a note\n```\n\n@');
    expect(inCode.some((i) => i.type === 'mark' && i.className === 'cm-md-footnote-label')).toBe(
      false,
    );
  });

  it('does not read "[^1]:" or a link as a reference', () => {
    expect(inline('[^1]: only a definition\n\n@').some((i) => i.type === 'hide')).toBe(false);
    expect(
      inline('A [text](url) and [^ x] here\n\n@').some(
        (i) => i.type === 'mark' && i.className === 'cm-md-footnote-ref',
      ),
    ).toBe(false);
  });

  it('finds definitions with their continuation lines', () => {
    const state = stateWithCursor(DOC);
    const found = footnoteDefinitions(state.doc);
    expect([...found.keys()]).toEqual(['1', 'long-name']);
    expect(found.get('long-name')?.text).toBe('A longer note.');
  });
});

describe('raw HTML blocks', () => {
  const html = '<div align="center">\n  <b>Hi</b>\n</div>\n\nAfter\n\n@';

  it('are drawn only when the setting is on', () => {
    const off = collectBlocks(stateWithCursor(html), '');
    expect(off.some((i) => i.type === 'html')).toBe(false);
    const on = collectBlocks(stateWithCursor(html, [renderHtmlFacet.of(true)]), '');
    expect(on).toEqual([
      { type: 'html', from: 0, to: 39, html: '<div align="center">\n  <b>Hi</b>\n</div>' },
    ]);
  });

  it('show their source while the cursor is in them', () => {
    const state = stateWithCursor('<div>\n  <b>@Hi</b>\n</div>\n', [renderHtmlFacet.of(true)]);
    expect(collectBlocks(state, '').some((i) => i.type === 'html')).toBe(false);
  });
});

describe('code fences', () => {
  const hidden = (items: InlineItem[]) =>
    items.filter((i) => i.type === 'hide').map((h) => [h.from, h.to]);

  it('hides the opening and closing fence lines while the cursor is away', () => {
    const items = inline('```js\nlet a;\n```\n\n@');
    expect(hidden(items)).toEqual([
      [0, 5],
      [13, 16],
    ]);
    expect(
      items.filter((i) => i.type === 'line' && i.className === 'cm-md-fence-hidden'),
    ).toHaveLength(2);
  });

  it('shows the fences while the cursor is inside the block', () => {
    expect(hidden(inline('```js\nlet@ a;\n```\n'))).toEqual([]);
  });

  it('leaves mermaid and math fences to their widgets', () => {
    expect(hidden(inline('```mermaid\ngraph TD\n```\n\n@'))).toEqual([]);
  });
});
