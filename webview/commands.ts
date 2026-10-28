// Formatting commands for the toolbar and shortcuts (PLAN.md §5, Phase 4). Each one is a pure
// function from the editor state to a transaction, and changes only the characters it has to
// (§3.6): toggling bold on a word adds or removes the two markers and leaves the rest alone.

import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type TransactionSpec,
} from '@codemirror/state';
import type { Command, KeyBinding } from '@codemirror/view';

export type Formatter = (state: EditorState) => TransactionSpec;

function countRun(state: EditorState, pos: number, char: string, step: 1 | -1): number {
  let count = 0;
  const limit = state.doc.length;
  for (let at = step === 1 ? pos : pos - 1; at >= 0 && at < limit; at += step) {
    if (state.sliceDoc(at, at + 1) !== char) break;
    count++;
  }
  return count;
}

/**
 * Wraps the selection in `marker` (`**`, `*`, `~~`, `` ` ``), or removes the marker when the
 * selection is already wrapped, either outside it or in the selected text itself.
 */
export function toggleWrap(state: EditorState, marker: string): TransactionSpec {
  const len = marker.length;
  const char = marker[0];
  return state.changeByRange((range) => {
    const { from, to } = range;
    const before = countRun(state, from, char, -1);
    const after = countRun(state, to, char, 1);
    const run = Math.min(before, after);
    // For `*`, a run of two is bold, so only an odd run means italic is on.
    const wrappedOutside = len === 1 ? run % 2 === 1 : run >= len;
    if (wrappedOutside) {
      return {
        changes: [
          { from: from - len, to: from },
          { from: to, to: to + len },
        ],
        range: EditorSelection.range(from - len, to - len),
      };
    }

    const text = state.sliceDoc(from, to);
    const doubled = marker + marker;
    const wrappedInside =
      text.length >= 2 * len &&
      text.startsWith(marker) &&
      text.endsWith(marker) &&
      (len > 1 || !text.startsWith(doubled));
    if (wrappedInside) {
      return {
        changes: { from, to, insert: text.slice(len, text.length - len) },
        range: EditorSelection.range(from, to - 2 * len),
      };
    }

    // Spaces just inside a marker would stop it from working (`** x**` is not bold).
    const lead = text.length - text.trimStart().length;
    const trail = text.length - text.trimEnd().length;
    if (lead === text.length) {
      return {
        changes: { from, to, insert: marker + text + marker },
        range: EditorSelection.cursor(from + len + (to - from)),
      };
    }
    const start = from + lead;
    const end = to - trail;
    return {
      changes: [
        { from: start, insert: marker },
        { from: end, insert: marker },
      ],
      range: EditorSelection.range(start + len, end + len),
    };
  });
}

function selectedLines(state: EditorState) {
  const lines = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) {
      if (!seen.has(n)) {
        seen.add(n);
        lines.push(state.doc.line(n));
      }
    }
  }
  // With several lines selected, blank ones are left alone; a lone blank line is the target.
  return lines.length > 1 ? lines.filter((line) => line.text.trim() !== '') : lines;
}

/** `# ` to `###### ` at the start of every selected line; level 0 removes it. */
export function setHeading(state: EditorState, level: number): TransactionSpec {
  const lines = selectedLines(state);
  const prefix = /^#{1,6}[ \t]+/;
  const marker = level > 0 ? '#'.repeat(level) + ' ' : '';
  const allSame = lines.every((line) => prefix.exec(line.text)?.[0].trim() === marker.trim());
  const changes: ChangeSpec[] = [];
  for (const line of lines) {
    const existing = prefix.exec(line.text)?.[0] ?? '';
    const insert = allSame ? '' : marker;
    if (existing !== insert) {
      changes.push({ from: line.from, to: line.from + existing.length, insert });
    }
  }
  return { changes };
}

export type LineKind = 'quote' | 'bullet' | 'number' | 'task';

const QUOTE = /^>[ \t]?/;
const LIST_MARKER = /^(\s*)(?:[-*+]|\d+[.)])(?: \[[ xX]\])?[ \t]+/;

function listKind(marker: string): LineKind {
  if (/\[[ xX]\]/.test(marker)) return 'task';
  return /\d/.test(marker) ? 'number' : 'bullet';
}

/** Adds or removes a quote or list marker on every selected line. */
export function toggleLineKind(state: EditorState, kind: LineKind): TransactionSpec {
  const lines = selectedLines(state);
  const changes: ChangeSpec[] = [];
  if (kind === 'quote') {
    const allQuoted = lines.every((line) => QUOTE.test(line.text));
    for (const line of lines) {
      if (allQuoted) {
        changes.push({ from: line.from, to: line.from + QUOTE.exec(line.text)![0].length });
      } else if (!QUOTE.test(line.text)) {
        changes.push({ from: line.from, insert: '> ' });
      }
    }
    return { changes };
  }
  const allSame = lines.every((line) => {
    const match = LIST_MARKER.exec(line.text);
    return match !== null && listKind(match[0]) === kind;
  });
  let number = 1;
  for (const line of lines) {
    const match = LIST_MARKER.exec(line.text);
    const indent = match?.[1] ?? /^\s*/.exec(line.text)![0];
    const from = line.from + indent.length;
    const existingEnd = match ? line.from + match[0].length : from;
    if (allSame) {
      changes.push({ from, to: existingEnd });
      continue;
    }
    const marker = kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${number++}. `;
    changes.push({ from, to: existingEnd, insert: marker });
  }
  return { changes };
}

/** `[text](url)` around the selection, with the part to type next selected. */
export function insertLink(state: EditorState): TransactionSpec {
  return state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (/^(https?:\/\/|mailto:|www\.)\S+$/.test(text)) {
      // A selected URL becomes the target; the cursor goes where the text is typed.
      return {
        changes: { from: range.from, to: range.to, insert: `[](${text})` },
        range: EditorSelection.cursor(range.from + 1),
      };
    }
    const insert = `[${text}](url)`;
    const urlStart = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: text
        ? EditorSelection.range(urlStart, urlStart + 3)
        : EditorSelection.cursor(range.from + 1),
    };
  });
}

const TABLE = '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n';

/** A two-column table on its own lines below the cursor's line, with the first heading selected. */
export function insertTable(state: EditorState): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head);
  const onBlankLine = line.text.trim() === '';
  const pos = onBlankLine ? line.from : line.to;
  const insert = (onBlankLine ? '' : '\n\n') + TABLE;
  const start = pos + insert.indexOf('Column 1');
  return {
    changes: { from: pos, to: onBlankLine ? line.to : pos, insert },
    selection: EditorSelection.range(start, start + 'Column 1'.length),
  };
}

function command(formatter: Formatter): Command {
  return (view) => {
    if (view.state.readOnly) return false;
    view.dispatch(view.state.update(formatter(view.state), { userEvent: 'input.format' }));
    return true;
  };
}

export const commands = {
  bold: command((s) => toggleWrap(s, '**')),
  italic: command((s) => toggleWrap(s, '*')),
  strike: command((s) => toggleWrap(s, '~~')),
  code: command((s) => toggleWrap(s, '`')),
  h1: command((s) => setHeading(s, 1)),
  h2: command((s) => setHeading(s, 2)),
  h3: command((s) => setHeading(s, 3)),
  bullet: command((s) => toggleLineKind(s, 'bullet')),
  number: command((s) => toggleLineKind(s, 'number')),
  task: command((s) => toggleLineKind(s, 'task')),
  quote: command((s) => toggleLineKind(s, 'quote')),
  link: command(insertLink),
  table: command(insertTable),
} satisfies Record<string, Command>;

export const formattingKeymap: readonly KeyBinding[] = [
  { key: 'Mod-b', run: commands.bold },
  { key: 'Mod-i', run: commands.italic },
  { key: 'Mod-Shift-x', run: commands.strike },
  { key: 'Mod-e', run: commands.code },
  { key: 'Mod-k', run: commands.link },
  { key: 'Mod-Alt-1', run: commands.h1 },
  { key: 'Mod-Alt-2', run: commands.h2 },
  { key: 'Mod-Alt-3', run: commands.h3 },
  { key: 'Mod-Shift-7', run: commands.number },
  { key: 'Mod-Shift-8', run: commands.bullet },
  { key: 'Mod-Shift-9', run: commands.quote },
];
