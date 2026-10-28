import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  insertLink,
  insertTable,
  setHeading,
  toggleLineKind,
  toggleTask,
  toggleWrap,
} from '../../webview/commands';
import { collectInline } from '../../webview/livePreview/inline';
import { readingFacet } from '../../webview/livePreview/reveal';

/** `[[` and `]]` mark the selection in the text; a lone `@` marks a cursor. */
function make(marked: string): EditorState {
  const open = marked.indexOf('[[');
  let doc: string;
  let selection: EditorSelection;
  if (open >= 0) {
    const close = marked.indexOf(']]');
    doc = marked.slice(0, open) + marked.slice(open + 2, close) + marked.slice(close + 2);
    selection = EditorSelection.single(open, close - 2);
  } else {
    doc = marked.replace('@', '');
    selection = EditorSelection.single(marked.indexOf('@'));
  }
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

function apply(state: EditorState, spec: TransactionSpec): string {
  return state.update(spec).state.doc.toString();
}

function selected(state: EditorState, spec: TransactionSpec): string {
  const next = state.update(spec).state;
  const { from, to } = next.selection.main;
  return next.sliceDoc(from, to);
}

describe('toggleWrap', () => {
  it('wraps the selection and keeps it selected', () => {
    const state = make('say [[hello]] now');
    expect(apply(state, toggleWrap(state, '**'))).toBe('say **hello** now');
    expect(selected(state, toggleWrap(state, '**'))).toBe('hello');
  });

  it('removes the markers when the selection is already wrapped', () => {
    const state = make('say **[[hello]]** now');
    expect(apply(state, toggleWrap(state, '**'))).toBe('say hello now');
  });

  it('removes the markers when they are part of the selection', () => {
    const state = make('say [[**hello**]] now');
    expect(apply(state, toggleWrap(state, '**'))).toBe('say hello now');
  });

  it('inserts a pair around the cursor, and removes an empty pair', () => {
    const state = make('a @ b');
    const next = state.update(toggleWrap(state, '*')).state;
    expect(next.doc.toString()).toBe('a ** b');
    expect(next.selection.main.head).toBe(3);
    expect(apply(next, toggleWrap(next, '*'))).toBe('a  b');
  });

  it('treats ** as bold, not as italic, when toggling italic', () => {
    const bold = make('**[[hi]]**');
    expect(apply(bold, toggleWrap(bold, '*'))).toBe('***hi***');
    const both = make('***[[hi]]***');
    expect(apply(both, toggleWrap(both, '*'))).toBe('**hi**');
    expect(apply(both, toggleWrap(both, '**'))).toBe('*hi*');
  });

  it('keeps spaces outside the markers', () => {
    const state = make('a[[ word ]]b');
    expect(apply(state, toggleWrap(state, '**'))).toBe('a **word** b');
  });

  it('changes nothing outside the markers', () => {
    const state = make('# Title\n\nsome [[text]] here\n\n- item\n');
    const next = state.update(toggleWrap(state, '~~'));
    let changed = 0;
    next.changes.iterChanges((from, to, _a, _b, text) => (changed += to - from + text.length));
    expect(changed).toBe(4);
  });
});

describe('setHeading', () => {
  it('adds, changes and removes a heading marker', () => {
    let state = make('some @text');
    state = state.update(setHeading(state, 2)).state;
    expect(state.doc.toString()).toBe('## some text');
    state = state.update(setHeading(state, 3)).state;
    expect(state.doc.toString()).toBe('### some text');
    state = state.update(setHeading(state, 3)).state;
    expect(state.doc.toString()).toBe('some text');
  });

  it('applies to every selected line but not to blank ones', () => {
    const state = make('[[one\n\ntwo]]');
    expect(apply(state, setHeading(state, 1))).toBe('# one\n\n# two');
  });
});

describe('toggleLineKind', () => {
  it('toggles a quote on every selected line', () => {
    const state = make('[[a\nb]]');
    expect(apply(state, toggleLineKind(state, 'quote'))).toBe('> a\n> b');
    const again = make('[[> a\n> b]]');
    expect(apply(again, toggleLineKind(again, 'quote'))).toBe('a\nb');
  });

  it('makes numbered lists count up and keeps indentation', () => {
    const state = make('[[a\n  b\nc]]');
    expect(apply(state, toggleLineKind(state, 'number'))).toBe('1. a\n  2. b\n3. c');
  });

  it('switches between list kinds and removes a matching one', () => {
    const bullets = make('[[- a\n- b]]');
    expect(apply(bullets, toggleLineKind(bullets, 'task'))).toBe('- [ ] a\n- [ ] b');
    expect(apply(bullets, toggleLineKind(bullets, 'bullet'))).toBe('a\nb');
    const tasks = make('[[- [x] a]]');
    expect(apply(tasks, toggleLineKind(tasks, 'bullet'))).toBe('- a');
  });
});

describe('insertLink', () => {
  it('wraps the selection and selects the url placeholder', () => {
    const state = make('see [[docs]] here');
    expect(apply(state, insertLink(state))).toBe('see [docs](url) here');
    expect(selected(state, insertLink(state))).toBe('url');
  });

  it('uses a selected web address as the target', () => {
    const state = make('[[https://example.com]]');
    expect(apply(state, insertLink(state))).toBe('[](https://example.com)');
  });

  it('puts the cursor between the brackets when nothing is selected', () => {
    const state = make('@');
    const next = state.update(insertLink(state)).state;
    expect(next.doc.toString()).toBe('[](url)');
    expect(next.selection.main.head).toBe(1);
  });
});

describe('insertTable', () => {
  it('inserts below a line of text, separated by a blank line', () => {
    const state = make('para@graph');
    const next = state.update(insertTable(state)).state;
    expect(next.doc.toString()).toMatch(/^paragraph\n\n\| Column 1 \| Column 2 \|\n\| --- \|/);
    const { from, to } = next.selection.main;
    expect(next.sliceDoc(from, to)).toBe('Column 1');
  });

  it('inserts on an empty line without extra blank lines', () => {
    const state = make('@');
    expect(apply(state, insertTable(state))).toMatch(/^\| Column 1/);
  });
});

describe('list continuation from the Markdown package', () => {
  function enter(marked: string): string {
    const state = make(marked);
    let next = state;
    insertNewlineContinueMarkup({ state, dispatch: (tr) => (next = tr.state) });
    return next.doc.toString();
  }

  it('Enter continues a bullet, a numbered and a task list', () => {
    expect(enter('- one@')).toBe('- one\n- ');
    expect(enter('1. one@')).toBe('1. one\n2. ');
    expect(enter('- [x] done@')).toBe('- [x] done\n- [ ] ');
  });

  it('Enter on an empty item ends the list', () => {
    // The first Enter on an empty second item starts a loose list; the next one ends it.
    expect(enter('- one\n- @')).toBe('- one\n\n- ');
    expect(enter('- one\n\n- @')).toBe('- one\n\n');
    expect(enter('- @')).toBe('');
  });
});

describe('Reading mode', () => {
  const doc = 'some **bold** text';

  function hiddenCount(reading: boolean): number {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(8),
      extensions: [markdown({ base: markdownLanguage }), readingFacet.of(reading)],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    return collectInline(state, 0, doc.length).filter((i) => i.type === 'hide').length;
  }

  it('hides symbols even where the cursor is', () => {
    expect(hiddenCount(false)).toBe(0);
    expect(hiddenCount(true)).toBe(2);
  });
});

describe('toggleTask', () => {
  it('ticks and unticks the task on the cursor line with a one-character edit', () => {
    let state = make('- [ ] one\n- [ ] t@wo\n');
    state = state.update(toggleTask(state)).state;
    expect(state.doc.toString()).toBe('- [ ] one\n- [x] two\n');
    state = state.update(toggleTask(state)).state;
    expect(state.doc.toString()).toBe('- [ ] one\n- [ ] two\n');
  });

  it('ignores lines that are not tasks', () => {
    const state = make('plain @text');
    expect(apply(state, toggleTask(state))).toBe('plain text');
  });
});
