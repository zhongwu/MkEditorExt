// Inline live preview (PLAN.md §3.5): styles Markdown and hides its symbols away from the cursor.
// Everything here is a decoration; the document text is never changed.

import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { isTouched } from './reveal';

export type InlineItem =
  /** Text hidden from view (the Markdown symbols). */
  | { type: 'hide'; from: number; to: number }
  /** A styled range, e.g. bold text. */
  | { type: 'mark'; from: number; to: number; className: string }
  /** A class for a whole line, e.g. a heading. Always applied, so line heights never change. */
  | { type: 'line'; pos: number; className: string }
  /** A bullet list marker drawn as a bullet. */
  | { type: 'bullet'; from: number; to: number };

const HEADING = /^(ATX|Setext)Heading([1-6])$/;

const INLINE_STYLES: Record<string, { className: string; marks: string }> = {
  Emphasis: { className: 'cm-md-em', marks: 'EmphasisMark' },
  StrongEmphasis: { className: 'cm-md-strong', marks: 'EmphasisMark' },
  Strikethrough: { className: 'cm-md-strike', marks: 'StrikethroughMark' },
  InlineCode: { className: 'cm-md-code', marks: 'CodeMark' },
};

/** Everything the inline live preview draws for the part of the document in [from, to]. */
export function collectInline(state: EditorState, from: number, to: number): InlineItem[] {
  const items: InlineItem[] = [];
  const { doc, selection } = state;
  const touched = (node: { from: number; to: number }) => isTouched(selection, node.from, node.to);
  const text = (a: number, b: number) => doc.sliceString(a, b);

  const eachLine = (node: SyntaxNode, className: string) => {
    for (let n = doc.lineAt(node.from).number; n <= doc.lineAt(node.to).number; n++) {
      items.push({ type: 'line', pos: doc.line(n).from, className });
    }
  };

  syntaxTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      const node = ref.node;
      const name = node.name;

      const heading = HEADING.exec(name);
      if (heading) {
        const [, kind, level] = heading;
        const firstLine = doc.lineAt(node.from);
        items.push({
          type: 'line',
          pos: firstLine.from,
          className: `cm-md-heading cm-md-h${level}`,
        });
        if (kind === 'Setext') {
          items.push({
            type: 'line',
            pos: doc.lineAt(node.to).from,
            className: 'cm-md-setext-mark',
          });
        } else if (!touched(node)) {
          for (const mark of node.getChildren('HeaderMark')) {
            if (mark.from === node.from) {
              // Opening "# ", with the spaces after it.
              let end = mark.to;
              while (end < node.to && text(end, end + 1) === ' ') end++;
              items.push({ type: 'hide', from: mark.from, to: end });
            } else {
              // Closing " ##", with the spaces before it.
              let start = mark.from;
              while (start > node.from && text(start - 1, start) === ' ') start--;
              items.push({ type: 'hide', from: start, to: mark.to });
            }
          }
        }
        return;
      }

      const style = INLINE_STYLES[name];
      if (style) {
        items.push({ type: 'mark', from: node.from, to: node.to, className: style.className });
        if (!touched(node)) {
          for (const mark of node.getChildren(style.marks)) {
            items.push({ type: 'hide', from: mark.from, to: mark.to });
          }
        }
        return;
      }

      switch (name) {
        case 'Link': {
          const marks = node.getChildren('LinkMark');
          if (marks.length < 2) return;
          const [open, close] = marks;
          items.push({ type: 'mark', from: open.to, to: close.from, className: 'cm-md-link' });
          if (!touched(node)) {
            items.push({ type: 'hide', from: open.from, to: open.to });
            // "](url "title")", "][label]" or "]".
            items.push({ type: 'hide', from: close.from, to: node.to });
          }
          return;
        }
        case 'Autolink': {
          const url = node.getChild('URL');
          if (url) {
            items.push({ type: 'mark', from: url.from, to: url.to, className: 'cm-md-link' });
          }
          if (!touched(node)) {
            for (const mark of node.getChildren('LinkMark')) {
              items.push({ type: 'hide', from: mark.from, to: mark.to });
            }
          }
          return false;
        }
        case 'URL':
          // A bare URL (GitHub-style autolink); URLs inside links are handled above.
          if (node.parent?.name === 'Paragraph' || node.parent?.name === 'TableCell') {
            items.push({ type: 'mark', from: node.from, to: node.to, className: 'cm-md-link' });
          }
          return;
        case 'Blockquote':
          eachLine(node, 'cm-md-quote');
          return;
        case 'QuoteMark': {
          // Quote symbols are per line, so they are shown while the cursor is on that line.
          const line = doc.lineAt(node.from);
          if (!isTouched(selection, line.from, line.to)) {
            const end = text(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            items.push({ type: 'hide', from: node.from, to: end });
          }
          return;
        }
        case 'ListMark': {
          const item = node.parent;
          const isBullet = item?.parent?.name === 'BulletList';
          // Task items get a checkbox in Phase 3; keep their marker as text for now.
          const isTask = item?.getChild('Task') !== null;
          if (isBullet && !isTask && !isTouched(selection, node.from, node.to + 1)) {
            items.push({ type: 'bullet', from: node.from, to: node.to });
          } else {
            items.push({ type: 'mark', from: node.from, to: node.to, className: 'cm-md-listmark' });
          }
          return;
        }
        case 'FencedCode':
        case 'CodeBlock':
          // Code keeps its own highlighting; Markdown inside it is not styled.
          eachLine(node, 'cm-md-codeblock');
          return false;
        case 'Image':
          // Rendered as a widget in Phase 3.
          return false;
      }
      return;
    },
  });

  return items;
}

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-md-bullet';
    span.textContent = '•';
    return span;
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const hide = Decoration.replace({});
const markCache = new Map<string, Decoration>();
const lineCache = new Map<string, Decoration>();

function openLinkHint(): string {
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  return isMac ? 'Cmd+click to open' : 'Ctrl+click to open';
}

function markDecoration(className: string): Decoration {
  let deco = markCache.get(className);
  if (!deco) {
    deco = Decoration.mark({
      class: className,
      attributes: className === 'cm-md-link' ? { title: openLinkHint() } : undefined,
    });
    markCache.set(className, deco);
  }
  return deco;
}

function lineDecoration(className: string): Decoration {
  let deco = lineCache.get(className);
  if (!deco) {
    deco = Decoration.line({ class: className });
    lineCache.set(className, deco);
  }
  return deco;
}

export function toDecorations(items: readonly InlineItem[]): DecorationSet {
  const seen = new Set<string>();
  const ranges: Range<Decoration>[] = [];
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    switch (item.type) {
      case 'hide':
        if (item.to > item.from) ranges.push(hide.range(item.from, item.to));
        break;
      case 'bullet':
        ranges.push(bullet.range(item.from, item.to));
        break;
      case 'mark':
        if (item.to > item.from)
          ranges.push(markDecoration(item.className).range(item.from, item.to));
        break;
      case 'line':
        ranges.push(lineDecoration(item.className).range(item.pos));
        break;
    }
  }
  return Decoration.set(ranges, true);
}

function build(view: EditorView): DecorationSet {
  const items: InlineItem[] = [];
  for (const { from, to } of view.visibleRanges) {
    items.push(...collectInline(view.state, from, to));
  }
  return toDecorations(items);
}

/** The inline live preview, computed for the visible part of the document only. */
export const inlinePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
