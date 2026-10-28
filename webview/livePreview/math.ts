// Markdown syntax for math (PLAN.md §2): `$x$` and `$$x$$` inside a paragraph, and `$$` blocks.
// The standard Markdown parser doesn't know them, so this adds `InlineMath` and `BlockMath` nodes,
// each with `MathMark` children for the `$` symbols. Math inside ``` fences is handled in blocks.ts.

import type { MarkdownConfig } from '@lezer/markdown';

const DOLLAR = 36;
const BACKSLASH = 92;
const SPACE = 32;

const isDigit = (code: number) => code >= 48 && code <= 57;

export const mathExtension: MarkdownConfig = {
  defineNodes: [{ name: 'InlineMath' }, { name: 'BlockMath', block: true }, { name: 'MathMark' }],
  parseInline: [
    {
      name: 'InlineMath',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1;
        const double = cx.char(pos + 1) === DOLLAR;
        const open = double ? 2 : 1;
        const start = pos + open;
        // "$5 and $6" is not math: the text after a single opening $ must not start with a space.
        if (start >= cx.end || (!double && cx.char(start) === SPACE)) return -1;
        for (let i = start; i < cx.end; i++) {
          const char = cx.char(i);
          if (char === BACKSLASH) {
            i++;
          } else if (char === DOLLAR) {
            const closes = double
              ? cx.char(i + 1) === DOLLAR
              : cx.char(i - 1) !== SPACE && !isDigit(cx.char(i + 1));
            if (!closes) continue;
            if (i === start) return -1;
            const end = i + open;
            return cx.addElement(
              cx.elt('InlineMath', pos, end, [
                cx.elt('MathMark', pos, start),
                cx.elt('MathMark', i, end),
              ]),
            );
          }
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      parse(cx, line) {
        const text = line.text.slice(line.pos);
        if (!text.startsWith('$$')) return false;
        const from = cx.lineStart + line.pos;
        const rest = text.slice(2);
        const closing = (s: string) => /\$\$\s*$/.test(s);
        let to = cx.lineStart + line.text.length;
        const marks = [cx.elt('MathMark', from, from + 2)];
        if (closing(rest) && rest.trim() !== '') {
          // $$ x $$ on one line.
          marks.push(cx.elt('MathMark', to - rest.length + rest.lastIndexOf('$$'), to));
          cx.nextLine();
        } else {
          // Without a closing $$ the block runs to the end of the document.
          while (cx.nextLine()) {
            to = cx.lineStart + line.text.length;
            if (closing(line.text)) {
              const trailing = line.text.length - line.text.trimEnd().length;
              marks.push(cx.elt('MathMark', to - trailing - 2, to));
              cx.nextLine();
              break;
            }
          }
        }
        cx.addElement(cx.elt('BlockMath', from, to, marks));
        return true;
      },
    },
  ],
};
