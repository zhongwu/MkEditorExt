// Block-level live preview (PLAN.md §3.5): images, task checkboxes, tables, horizontal rules and
// front matter drawn as widgets over the unchanged text. A widget is shown while the selection is
// outside it; moving the cursor in (or clicking it) shows the source instead.
//
// `collectBlocks` works out what to draw and has no DOM, so it can be unit-tested. `blockPreview`
// turns that into decorations. Block decorations must come from a state field, not a view plugin.

import { syntaxTree } from '@codemirror/language';
import { EditorState, Facet, StateField, type Range, type Text } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { findFrontMatter } from './frontMatter';
import { HtmlWidget } from './htmlWidget';
import { resolveImageSrc } from './images';
import { MathWidget, MermaidWidget } from './renderWidgets';
import { isTouched, readingFacet, revealSelection } from './reveal';
import { CheckboxWidget, FrontMatterWidget, HrWidget, ImageWidget, TableWidget } from './widgets';

/** A piece of inline text inside a table cell. */
export type Span =
  | { type: 'text'; text: string }
  | { type: 'em' | 'strong' | 'del' | 'code'; children: Span[] }
  | { type: 'link'; href: string; children: Span[] };

export type Align = 'left' | 'center' | 'right' | null;

export interface TableData {
  align: Align[];
  header: Span[][];
  rows: Span[][][];
}

export type BlockItem =
  | { type: 'hr'; from: number; to: number }
  | { type: 'frontMatter'; from: number; to: number; entries: [string, string][] }
  | { type: 'table'; from: number; to: number; data: TableData }
  /** `revealed`: the cursor is in the image's source, so the image is drawn below it instead. */
  | { type: 'image'; from: number; to: number; src: string; alt: string; revealed: boolean }
  /** `offset`: where the `[ ]` character to toggle sits, counted from `from`. */
  | { type: 'checkbox'; from: number; to: number; checked: boolean; offset: number }
  | { type: 'math'; from: number; to: number; tex: string; display: boolean }
  | { type: 'mermaid'; from: number; to: number; source: string }
  | { type: 'html'; from: number; to: number; html: string };

/** Whether raw HTML blocks are drawn (the `mdEditor.renderHtml` setting). Off by default. */
export const renderHtmlFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

const MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark']);

/** The inline content of `node` between `from` and `to`, without its Markdown symbols. */
function inlineSpans(doc: Text, node: SyntaxNode, from = node.from, to = node.to): Span[] {
  const out: Span[] = [];
  let pos = from;
  const text = (a: number, b: number) => {
    if (b > a) out.push({ type: 'text', text: doc.sliceString(a, b) });
  };
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from) continue;
    if (child.from >= to) break;
    text(pos, child.from);
    pos = child.to;
    switch (child.name) {
      case 'Emphasis':
        out.push({ type: 'em', children: inlineSpans(doc, child) });
        break;
      case 'StrongEmphasis':
        out.push({ type: 'strong', children: inlineSpans(doc, child) });
        break;
      case 'Strikethrough':
        out.push({ type: 'del', children: inlineSpans(doc, child) });
        break;
      case 'InlineCode':
        out.push({ type: 'code', children: inlineSpans(doc, child) });
        break;
      case 'Link': {
        const [open, close] = child.getChildren('LinkMark');
        const url = child.getChild('URL');
        if (open && close) {
          const children = inlineSpans(doc, child, open.to, close.from);
          out.push(
            url
              ? { type: 'link', href: doc.sliceString(url.from, url.to), children }
              : { type: 'em', children },
          );
        } else {
          text(child.from, child.to);
        }
        break;
      }
      case 'Image': {
        const [open, close] = child.getChildren('LinkMark');
        if (open && close) text(open.to, close.from);
        break;
      }
      case 'Escape':
        text(child.from + 1, child.to);
        break;
      default:
        if (!MARKS.has(child.name)) text(child.from, child.to);
    }
  }
  text(pos, to);
  return out;
}

function trimmed(spans: Span[]): Span[] {
  const first = spans[0];
  if (first?.type === 'text') spans[0] = { type: 'text', text: first.text.trimStart() };
  const last = spans[spans.length - 1];
  if (last?.type === 'text') spans[spans.length - 1] = { type: 'text', text: last.text.trimEnd() };
  return spans.filter((s) => s.type !== 'text' || s.text !== '');
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(':');
  const right = c.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

function tableData(doc: Text, node: SyntaxNode): TableData | undefined {
  const head = node.getChild('TableHeader');
  if (!head) return undefined;
  const cells = (row: SyntaxNode) =>
    row.getChildren('TableCell').map((cell) => trimmed(inlineSpans(doc, cell)));
  const delimiterLine = doc.lineAt(head.to).number + 1;
  const delimiter = delimiterLine <= doc.lines ? doc.line(delimiterLine).text : '';
  const align = delimiter.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(alignOf);
  return { align, header: cells(head), rows: node.getChildren('TableRow').map(cells) };
}

/** Everything the block live preview draws, given the text, the tree and the selection. */
export function collectBlocks(state: EditorState, baseUri: string): BlockItem[] {
  const items: BlockItem[] = [];
  const { doc } = state;
  const selection = revealSelection(state);
  const touched = (from: number, to: number) => isTouched(selection, from, to);

  const frontMatter = findFrontMatter(doc);
  if (frontMatter && !touched(frontMatter.from, frontMatter.to)) {
    items.push({ type: 'frontMatter', ...frontMatter });
  }
  const skipUntil = frontMatter?.to ?? -1;
  const renderHtml = state.facet(renderHtmlFacet);

  syntaxTree(state).iterate({
    enter: (ref) => {
      const node = ref.node;
      if (node.to <= skipUntil) return false;
      const topLevel = node.parent?.name === 'Document';
      switch (node.name) {
        case 'HorizontalRule':
          if (topLevel && !touched(node.from, node.to)) {
            items.push({ type: 'hr', from: node.from, to: node.to });
          }
          return false;
        case 'Table': {
          if (topLevel && !touched(node.from, node.to)) {
            const data = tableData(doc, node);
            if (data) items.push({ type: 'table', from: node.from, to: node.to, data });
          }
          return false;
        }
        case 'Image': {
          const [open, close] = node.getChildren('LinkMark');
          const url = node.getChild('URL');
          const src = url ? resolveImageSrc(doc.sliceString(url.from, url.to), baseUri) : undefined;
          if (src && open && close) {
            const line = doc.lineAt(node.from);
            const revealed = touched(node.from, node.to);
            items.push({
              type: 'image',
              // Drawn below the line while its source is shown.
              from: revealed ? line.to : node.from,
              to: revealed ? line.to : node.to,
              src,
              alt: doc.sliceString(open.to, close.from),
              revealed,
            });
          }
          return false;
        }
        case 'HTMLBlock':
          if (renderHtml && topLevel && !touched(node.from, node.to)) {
            items.push({
              type: 'html',
              from: node.from,
              to: node.to,
              html: doc.sliceString(node.from, node.to),
            });
          }
          return false;
        case 'InlineMath': {
          const [open, close] = node.getChildren('MathMark');
          if (open && close && !touched(node.from, node.to)) {
            const tex = doc.sliceString(open.to, close.from);
            items.push({ type: 'math', from: node.from, to: node.to, tex, display: false });
          }
          return false;
        }
        case 'BlockMath': {
          if (topLevel && !touched(node.from, node.to)) {
            const marks = node.getChildren('MathMark');
            const close = marks.length > 1 ? marks[marks.length - 1] : undefined;
            const tex = doc.sliceString(marks[0].to, close ? close.from : node.to).trim();
            if (tex) items.push({ type: 'math', from: node.from, to: node.to, tex, display: true });
          }
          return false;
        }
        case 'FencedCode': {
          const info = node.getChild('CodeInfo');
          const language = info ? doc.sliceString(info.from, info.to).trim().toLowerCase() : '';
          if (topLevel && (language === 'math' || language === 'mermaid')) {
            if (!touched(node.from, node.to)) {
              const code = node.getChild('CodeText');
              const source = code ? doc.sliceString(code.from, code.to).trim() : '';
              if (source) {
                items.push(
                  language === 'math'
                    ? { type: 'math', from: node.from, to: node.to, tex: source, display: true }
                    : { type: 'mermaid', from: node.from, to: node.to, source },
                );
              }
            }
          }
          return false;
        }
        case 'TaskMarker': {
          const listMark = node.parent?.parent?.getChild('ListMark');
          if (listMark && !touched(listMark.from, node.to + 1)) {
            items.push({
              type: 'checkbox',
              from: listMark.from,
              to: node.to,
              checked: /\[[xX]\]/.test(doc.sliceString(node.from, node.to)),
              offset: node.from + 1 - listMark.from,
            });
          }
          return false;
        }
      }
      return undefined;
    },
  });
  return items;
}

export function toBlockDecorations(items: readonly BlockItem[], baseUri: string): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const item of items) {
    switch (item.type) {
      case 'hr':
        ranges.push(
          Decoration.replace({ widget: new HrWidget(), block: true }).range(item.from, item.to),
        );
        break;
      case 'frontMatter':
        ranges.push(
          Decoration.replace({ widget: new FrontMatterWidget(item.entries), block: true }).range(
            item.from,
            item.to,
          ),
        );
        break;
      case 'table':
        ranges.push(
          Decoration.replace({ widget: new TableWidget(item.data), block: true }).range(
            item.from,
            item.to,
          ),
        );
        break;
      case 'image': {
        const widget = new ImageWidget(item.src, item.alt, item.revealed);
        ranges.push(
          item.revealed
            ? Decoration.widget({ widget, block: true, side: 1 }).range(item.to)
            : Decoration.replace({ widget }).range(item.from, item.to),
        );
        break;
      }
      case 'math':
        ranges.push(
          Decoration.replace({
            widget: new MathWidget(item.tex, item.display),
            block: item.display,
          }).range(item.from, item.to),
        );
        break;
      case 'html':
        ranges.push(
          Decoration.replace({ widget: new HtmlWidget(item.html, baseUri), block: true }).range(
            item.from,
            item.to,
          ),
        );
        break;
      case 'mermaid':
        ranges.push(
          Decoration.replace({ widget: new MermaidWidget(item.source), block: true }).range(
            item.from,
            item.to,
          ),
        );
        break;
      case 'checkbox':
        ranges.push(
          Decoration.replace({ widget: new CheckboxWidget(item.checked, item.offset) }).range(
            item.from,
            item.to,
          ),
        );
        break;
    }
  }
  return Decoration.set(ranges, true);
}

/** The block live preview. `baseUri` is the document's folder as a webview URI, for images. */
export function blockPreview(baseUri: string) {
  const build = (state: EditorState) => toBlockDecorations(collectBlocks(state, baseUri), baseUri);
  return StateField.define<DecorationSet>({
    create: build,
    update(value, tr) {
      if (
        tr.docChanged ||
        tr.selection ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
        tr.startState.facet(renderHtmlFacet) !== tr.state.facet(renderHtmlFacet) ||
        tr.startState.facet(readingFacet) !== tr.state.facet(readingFacet)
      ) {
        return build(tr.state);
      }
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
