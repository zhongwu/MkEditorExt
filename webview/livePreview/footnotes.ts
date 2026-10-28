// Footnotes: `[^label]` references in text and `[^label]: text` definitions.
// The standard Markdown parser has no footnote syntax, so references get their own node
// (`FootnoteRef`, with `FootnoteMark` children for the `[^` and `]`). Definitions are found by
// line (see `footnoteDefinitions`), because the parser may read them as link references.

import type { Text } from '@codemirror/state';
import type { MarkdownConfig } from '@lezer/markdown';

const OPEN = 91; // [
const CLOSE = 93; // ]
const CARET = 94; // ^
const SPACE = 32;
const NEWLINE = 10;

export const footnoteExtension: MarkdownConfig = {
  defineNodes: [{ name: 'FootnoteRef' }, { name: 'FootnoteMark' }],
  parseInline: [
    {
      name: 'FootnoteRef',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== OPEN || cx.char(pos + 1) !== CARET) return -1;
        let i = pos + 2;
        while (i < cx.end && cx.char(i) !== CLOSE) {
          const char = cx.char(i);
          if (char === SPACE || char === NEWLINE || char === OPEN) return -1;
          i++;
        }
        // "[^1]:" is a definition (handled by line), not a reference.
        if (i >= cx.end || i === pos + 2 || cx.char(i + 1) === 58) return -1;
        return cx.addElement(
          cx.elt('FootnoteRef', pos, i + 1, [
            cx.elt('FootnoteMark', pos, pos + 2),
            cx.elt('FootnoteMark', i, i + 1),
          ]),
        );
      },
    },
  ],
};

const DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*/;

export interface FootnoteDefinition {
  label: string;
  /** Start and end of "[^label]:" at the start of the line. */
  from: number;
  to: number;
  /** The footnote's text: the rest of the line and any indented lines that follow. */
  text: string;
}

/** The footnote definitions that start between `from` and `to`, by label (the first one wins). */
export function footnoteDefinitions(
  doc: Text,
  from = 0,
  to = doc.length,
): Map<string, FootnoteDefinition> {
  const found = new Map<string, FootnoteDefinition>();
  for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
    const line = doc.line(n);
    const match = DEFINITION.exec(line.text);
    if (!match || found.has(match[1])) continue;
    const parts = [line.text.slice(match[0].length)];
    for (let m = n + 1; m <= doc.lines; m++) {
      const next = doc.line(m).text;
      if (!/^( {2,}|\t)\S/.test(next)) break;
      parts.push(next.trim());
    }
    found.set(match[1], {
      label: match[1],
      from: line.from,
      to: line.from + match[0].trimEnd().length,
      text: parts.join(' ').trim(),
    });
  }
  return found;
}
