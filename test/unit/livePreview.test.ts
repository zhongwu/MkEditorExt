import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { collectInline, type InlineItem } from '../../webview/livePreview/inline';
import { linkAt } from '../../webview/livePreview/links';

/**
 * Builds a state from text where `|` marks the cursor (or two `|` mark a selection).
 * The `|` characters are removed from the document.
 */
function stateWithCursor(marked: string): EditorState {
  const first = marked.indexOf('|');
  const second = first < 0 ? -1 : marked.indexOf('|', first + 1);
  const doc = marked.replace(/\|/g, '');
  const selection =
    first < 0
      ? EditorSelection.cursor(doc.length)
      : second < 0
        ? EditorSelection.cursor(first)
        : EditorSelection.range(first, second - 1);
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

function analyze(marked: string) {
  const state = stateWithCursor(marked);
  const items = collectInline(state, 0, state.doc.length);
  const slice = (i: { from: number; to: number }) => state.doc.sliceString(i.from, i.to);
  const of = <T extends InlineItem['type']>(type: T) =>
    items.filter((i): i is Extract<InlineItem, { type: T }> => i.type === type);
  return {
    hidden: of('hide').map(slice),
    marks: of('mark').map((m) => [m.className, slice(m)]),
    lines: of('line').map((l) => [state.doc.lineAt(l.pos).number, l.className]),
    bullets: of('bullet').map(slice),
  };
}

describe('inline live preview', () => {
  describe('headings', () => {
    it('hides "# " when the cursor is elsewhere', () => {
      const r = analyze('# Title\n\ntext|');
      expect(r.hidden).toEqual(['# ']);
      expect(r.lines).toEqual([[1, 'cm-md-heading cm-md-h1']]);
    });

    it('shows "#" when the cursor is in the heading, keeping the heading size', () => {
      const r = analyze('## Ti|tle\n\ntext');
      expect(r.hidden).toEqual([]);
      expect(r.lines).toEqual([[1, 'cm-md-heading cm-md-h2']]);
    });

    it('hides closing hashes too', () => {
      expect(analyze('### Title ###\n\nx|').hidden).toEqual(['### ', ' ###']);
    });

    it('styles setext headings without hiding the underline', () => {
      const r = analyze('Title\n=====\n\nx|');
      expect(r.hidden).toEqual([]);
      expect(r.lines).toEqual([
        [1, 'cm-md-heading cm-md-h1'],
        [2, 'cm-md-setext-mark'],
      ]);
    });
  });

  describe('emphasis, strikethrough and code', () => {
    it('hides the symbols and styles the text', () => {
      const r = analyze('a **bold** *it* ~~gone~~ `code`\n\n|');
      expect(r.hidden).toEqual(['**', '**', '*', '*', '~~', '~~', '`', '`']);
      expect(r.marks).toEqual([
        ['cm-md-strong', '**bold**'],
        ['cm-md-em', '*it*'],
        ['cm-md-strike', '~~gone~~'],
        ['cm-md-code', '`code`'],
      ]);
    });

    it('shows the symbols of the node the cursor is in, and only that node', () => {
      expect(analyze('**a|** and **b**').hidden).toEqual(['**', '**']);
      expect(analyze('**a** and **b**|').hidden).toEqual(['**', '**']);
    });

    it('counts a cursor right next to a node as touching it', () => {
      expect(analyze('|**a** x').hidden).toEqual([]);
      expect(analyze('**a**| x').hidden).toEqual([]);
    });

    it('shows the symbols of every node around the cursor', () => {
      expect(analyze('**bold *it|* x**').hidden).toEqual([]);
    });

    it('works with a selection', () => {
      expect(analyze('|**a** and **b**|').hidden).toEqual([]);
    });
  });

  describe('links', () => {
    it('hides the brackets and URL of an inline link', () => {
      const r = analyze('see [docs](https://x.y "Title") now\n\n|');
      expect(r.hidden).toEqual(['[', '](https://x.y "Title")']);
      expect(r.marks).toEqual([['cm-md-link', 'docs']]);
    });

    it('hides the label of a reference link', () => {
      expect(analyze('[docs][ref]\n\n[ref]: https://x.y\n|').hidden).toEqual(['[', '][ref]']);
    });

    it('shows the whole link while the cursor is in it', () => {
      expect(analyze('[do|cs](https://x.y)').hidden).toEqual([]);
    });

    it('hides the angle brackets of an autolink', () => {
      const r = analyze('<https://x.y>\n\n|');
      expect(r.hidden).toEqual(['<', '>']);
      expect(r.marks).toEqual([['cm-md-link', 'https://x.y']]);
    });

    it('styles a bare URL', () => {
      expect(analyze('go to https://x.y now\n\n|').marks).toEqual([['cm-md-link', 'https://x.y']]);
    });
  });

  describe('quotes and lists', () => {
    it('hides "> " on lines without the cursor and marks every quote line', () => {
      const r = analyze('> one\n> tw|o');
      expect(r.hidden).toEqual(['> ']);
      expect(r.lines).toEqual([
        [1, 'cm-md-quote'],
        [2, 'cm-md-quote'],
      ]);
    });

    it('draws bullets for bullet lists, showing the marker only when the cursor is at it', () => {
      expect(analyze('- one\n- two\n* thr|ee').bullets).toEqual(['-', '-', '*']);
      expect(analyze('- one\n- |two').bullets).toEqual(['-']);
    });

    it('keeps the number of an ordered list item', () => {
      const r = analyze('1. one\n2. two\n\n|');
      expect(r.bullets).toEqual([]);
      expect(r.marks).toEqual([
        ['cm-md-listmark', '1.'],
        ['cm-md-listmark', '2.'],
      ]);
    });

    it('leaves task items alone (checkboxes come in Phase 3)', () => {
      expect(analyze('- [ ] task\n\n|').bullets).toEqual([]);
    });
  });

  describe('code blocks', () => {
    it('marks every line and does not style Markdown inside', () => {
      const r = analyze('```\n**not bold**\n```\n\n|');
      expect(r.hidden).toEqual([]);
      expect(r.marks).toEqual([]);
      expect(r.lines).toEqual([
        [1, 'cm-md-codeblock'],
        [2, 'cm-md-codeblock'],
        [3, 'cm-md-codeblock'],
      ]);
    });
  });

  it('never hides anything when every node is touched by the cursor', () => {
    // Selecting everything reveals all symbols: the text is shown exactly as written.
    const all = '|# H\n\n**b** [l](u) `c` ~~s~~\n\n> q\n\n- i|';
    expect(analyze(all).hidden).toEqual([]);
  });
});

describe('linkAt', () => {
  const at = (marked: string) => {
    const state = stateWithCursor(marked);
    return linkAt(state, state.selection.main.head);
  };

  it('finds inline links, images and autolinks', () => {
    expect(at('see [do|cs](https://x.y "t")')).toBe('https://x.y');
    expect(at('![al|t](img/a.png)')).toBe('img/a.png');
    expect(at('<https://a|.b>')).toBe('https://a.b');
  });

  it('finds bare URLs', () => {
    expect(at('go to https://x.|y now')).toBe('https://x.y');
  });

  it('strips angle brackets around a link destination', () => {
    expect(at('[a|](<my file.md>)')).toBe('my file.md');
  });

  it('resolves reference links, ignoring case', () => {
    const refs = '\n\n[Ref]: https://r.example\n';
    expect(at(`[te|xt][ref]${refs}`)).toBe('https://r.example');
    expect(at(`[re|f][]${refs}`)).toBe('https://r.example');
    expect(at(`[re|f]${refs}`)).toBe('https://r.example');
  });

  it('returns undefined away from links', () => {
    expect(at('plain te|xt')).toBeUndefined();
    expect(at('[ref]: https://r|.example')).toBeUndefined();
  });
});
