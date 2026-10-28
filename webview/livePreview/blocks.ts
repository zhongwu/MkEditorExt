// Block-level live preview (PLAN.md §3.5): images, task checkboxes, tables, horizontal rules and
// front matter drawn as widgets over the unchanged text. A widget is shown while the selection is
// outside it; moving the cursor in (or clicking it) shows the source instead.
//
// `collectBlocks` works out what to draw and has no DOM, so it can be unit-tested. `blockPreview`
// turns that into decorations. Block decorations must come from a state field, not a view plugin.

import { syntaxTree } from '@codemirror/language';
import { EditorState, Facet, StateField, type Range, type Text } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { composingField, compositionEnded } from './composition';
import { findFrontMatter } from './frontMatter';
import { HtmlWidget } from './htmlWidget';
import { resolveImageSrc } from './images';
import { MathWidget, MermaidWidget } from './renderWidgets';
import { isTouched, readingFacet, revealSelection } from './reveal';
import { cellRanges, type CellRange } from './tableEdit';
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
  /** Where each cell sits, counted from the start of the table: the header first, then each row. */
  ranges: CellRange[][];
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
  const rows = node.getChildren('TableRow');
  const header = cells(head);
  const body = rows.map(cells);
  // A row whose cells cannot be matched to the text is shown but not editable.
  const rangesOf = (row: SyntaxNode, count: number) => {
    const line = doc.lineAt(row.from);
    const ranges = cellRanges(line.from - node.from, line.text);
    return ranges.length === count ? ranges : [];
  };
  return {
    align,
    header,
    rows: body,
    ranges: [rangesOf(head, header.length), ...rows.map((row, i) => rangesOf(row, body[i].length))],
  };
}

/**
 * Everything the block live preview draws, given the text, the tree and the selection. With a
 * `range`, only what is drawn for the top-level blocks inside it; the range must start and end
 * on block boundaries (see `blockSpan`).
 */
export function collectBlocks(
  state: EditorState,
  baseUri: string,
  range?: { from: number; to: number },
): BlockItem[] {
  const items: BlockItem[] = [];
  const { doc } = state;
  const selection = revealSelection(state);
  const touched = (from: number, to: number) => isTouched(selection, from, to);

  const frontMatter = findFrontMatter(doc);
  if (frontMatter && (!range || range.from === 0) && !touched(frontMatter.from, frontMatter.to)) {
    items.push({ type: 'frontMatter', ...frontMatter });
  }
  const skipUntil = frontMatter?.to ?? -1;
  const renderHtml = state.facet(renderHtmlFacet);

  syntaxTree(state).iterate({
    from: range?.from,
    to: range?.to,
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
  return Decoration.set(blockRanges(items, baseUri), true);
}

function blockRanges(items: readonly BlockItem[], baseUri: string): Range<Decoration>[] {
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
  return ranges;
}

/** The top-level block (a direct child of the document) that has `pos` in it, if any. */
function topLevelAt(tree: Tree, pos: number, side: -1 | 1): SyntaxNode | null {
  let node: SyntaxNode = tree.resolveInner(pos, side);
  while (node.parent?.parent) node = node.parent;
  return node.parent ? node : null;
}

/** [from, to] widened to whole top-level blocks, so that a block is never cut in two. */
export function blockSpan(tree: Tree, from: number, to: number): { from: number; to: number } {
  let start = from;
  let end = to;
  for (const side of [1, -1] as const) {
    start = Math.min(start, topLevelAt(tree, from, side)?.from ?? start);
    end = Math.max(end, topLevelAt(tree, to, side)?.to ?? end);
  }
  return { from: start, to: end };
}

/** What the block field holds: the decorations, and how far the tree had reached for them. */
interface BlockState {
  decorations: DecorationSet;
  parsed: number;
}

/**
 * The block live preview. `baseUri` is the document's folder as a webview URI, for images.
 *
 * On a large file, drawing everything again on every keystroke and cursor move is too slow, so
 * after the first pass only the top-level blocks that can have changed are collected again:
 * those around an edit (before and after it), those the cursor left or entered, and any part
 * of the document the parser has reached since.
 */
export function blockPreview(baseUri: string) {
  const full = (state: EditorState): BlockState => ({
    decorations: toBlockDecorations(collectBlocks(state, baseUri), baseUri),
    parsed: syntaxTree(state).length,
  });

  return StateField.define<BlockState>({
    create: full,
    update(value, tr) {
      const { state, startState } = tr;
      if (
        startState.facet(renderHtmlFacet) !== state.facet(renderHtmlFacet) ||
        startState.facet(readingFacet) !== state.facet(readingFacet)
      ) {
        return full(state);
      }
      if (compositionEnded(startState, state)) {
        return full(state);
      }
      if (state.field(composingField, false)) {
        // An IME composition is under way: keep what is drawn, moved along with the typing.
        return { decorations: value.decorations.map(tr.changes), parsed: value.parsed };
      }
      const tree = syntaxTree(state);
      const parsed = tr.docChanged ? tr.changes.mapPos(value.parsed, -1) : value.parsed;
      const grew = tree.length > parsed;
      if (!tr.docChanged && !tr.selection && !grew) {
        return value;
      }

      const length = state.doc.length;
      const clamp = (pos: number) => Math.min(Math.max(pos, 0), length);
      const dirty: { from: number; to: number }[] = [];
      // Touching counts the edges of a block, so look one character beyond the selection.
      const aroundSelection = (from: number, to: number) =>
        dirty.push(blockSpan(tree, clamp(from - 1), clamp(to + 1)));
      for (const range of startState.selection.ranges) {
        aroundSelection(tr.changes.mapPos(range.from, -1), tr.changes.mapPos(range.to, 1));
      }
      for (const range of state.selection.ranges) {
        aroundSelection(range.from, range.to);
      }
      const oldTree = syntaxTree(startState);
      tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        dirty.push(blockSpan(tree, fromB, toB));
        // The blocks the old text had there may have been joined or split by the edit.
        const before = blockSpan(oldTree, fromA, toA);
        dirty.push({
          from: clamp(tr.changes.mapPos(before.from, -1)),
          to: clamp(tr.changes.mapPos(before.to, 1)),
        });
      });
      const frontMatter = findFrontMatter(state.doc);
      if (frontMatter) dirty.push(blockSpan(tree, 0, frontMatter.to));
      if (grew) dirty.push(blockSpan(tree, clamp(parsed), tree.length));

      // An edit can join or split blocks, so a span grows until no widget made earlier and no
      // block in the new tree reaches out of it.
      const previous = value.decorations.map(tr.changes);
      const undo = tr.changes.invertedDesc;
      for (const span of dirty) {
        for (let grown = true; grown;) {
          grown = false;
          previous.between(span.from, span.to, (from, to) => {
            if (from < span.from || to > span.to) grown = true;
            span.from = Math.min(span.from, from);
            span.to = Math.max(span.to, to);
          });
          const wide = blockSpan(tree, span.from, span.to);
          if (wide.from < span.from || wide.to > span.to) grown = true;
          span.from = Math.min(span.from, wide.from);
          span.to = Math.max(span.to, wide.to);
          // Blocks after an edit can change too (an opened code fence swallows what follows),
          // so go on until the old tree and the new one agree about the next block.
          const next = tr.docChanged ? tree.topNode.childAfter(span.to) : null;
          if (next) {
            const oldFrom = undo.mapPos(next.from, -1);
            // Beyond what the old tree had parsed there was nothing drawn to get wrong.
            const old = oldFrom < oldTree.length ? topLevelAt(oldTree, oldFrom, 1) : undefined;
            const agrees =
              old === undefined ||
              (old !== null &&
                old.from === oldFrom &&
                old.to === undo.mapPos(next.to, 1) &&
                old.name === next.name);
            if (!agrees) {
              span.to = next.to;
              grown = true;
            }
          }
        }
      }

      dirty.sort((a, b) => a.from - b.from);
      const spans: { from: number; to: number }[] = [];
      for (const span of dirty) {
        const last = spans[spans.length - 1];
        if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
        else spans.push({ ...span });
      }

      let decorations = previous;
      for (const { from, to } of spans) {
        decorations = decorations.update({
          filter: (start, end) => start < from || end > to,
          filterFrom: from,
          filterTo: to,
          add: blockRanges(collectBlocks(state, baseUri, { from, to }), baseUri),
          sort: true,
        });
      }
      return { decorations, parsed: tree.length };
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });
}
