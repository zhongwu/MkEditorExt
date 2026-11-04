// The DOM for the block live preview widgets (see blocks.ts). Clicking a widget places the cursor
// in its source, which shows the source instead; only the checkbox handles clicks itself.

import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { EditorView, WidgetType } from '@codemirror/view';
import { l10n } from '../l10n';
import type { Span, TableData } from './blocks';
import { cellChange, cellRanges, nextBox } from './tableEdit';

/**
 * Clicking a widget puts the cursor at the start of its source, which shows the source instead.
 * (CodeMirror ignores events inside widgets, so this does it explicitly.)
 */
export function revealOnMouseDown(element: HTMLElement, view: EditorView): HTMLElement {
  element.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    view.dispatch({ selection: { anchor: view.posAtDOM(element) } });
    view.focus();
  });
  return element;
}

function renderSpans(spans: readonly Span[], parent: HTMLElement): void {
  for (const span of spans) {
    if (span.type === 'text') {
      parent.append(span.text);
      continue;
    }
    if (span.type === 'task') {
      const box = document.createElement('span');
      const modifier = {
        open: '',
        done: ' cm-md-checkbox-checked',
        crossed: ' cm-md-checkbox-crossed',
      };
      box.className = 'cm-md-checkbox' + modifier[span.state];
      box.setAttribute('role', 'checkbox');
      box.setAttribute('aria-checked', String(span.state === 'done'));
      box.setAttribute(
        'aria-label',
        span.state === 'crossed' ? l10n.t('Task (crossed out)') : l10n.t('Task'),
      );
      box.dataset.at = String(span.at);
      box.dataset.length = String(span.length);
      parent.append(box);
      continue;
    }
    const tag = { em: 'em', strong: 'strong', del: 'del', code: 'code', link: 'span' }[span.type];
    const el = document.createElement(tag);
    if (span.type === 'link') {
      // Not an <a href>: a navigating link inside the webview would leave the editor.
      el.className = 'cm-md-link';
      el.title = span.href;
    }
    renderSpans(span.children, el);
    parent.append(el);
  }
}

export class HrWidget extends WidgetType {
  constructor(readonly indent = 0) {
    super();
  }
  eq(other: HrWidget): boolean {
    return this.indent === other.indent;
  }
  toDOM(view: EditorView): HTMLElement {
    const hr = document.createElement('div');
    hr.className = 'cm-md-hr';
    indentBy(hr, view, this.indent);
    hr.setAttribute('role', 'separator');
    return revealOnMouseDown(hr, view);
  }
}

export class FrontMatterWidget extends WidgetType {
  constructor(readonly entries: readonly [string, string][]) {
    super();
  }
  eq(other: FrontMatterWidget): boolean {
    return JSON.stringify(this.entries) === JSON.stringify(other.entries);
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div');
    box.className = 'cm-md-frontmatter';
    box.setAttribute('role', 'group');
    box.setAttribute(
      'aria-label',
      l10n.t('Front matter: {0}', this.entries.map(([key]) => key).join(', ') || l10n.t('empty')),
    );
    const title = document.createElement('div');
    title.className = 'cm-md-frontmatter-title';
    title.textContent = l10n.t('Front matter');
    box.append(title);
    for (const [key, value] of this.entries) {
      const row = document.createElement('div');
      const k = document.createElement('span');
      k.className = 'cm-md-frontmatter-key';
      k.textContent = key;
      row.append(k, value);
      box.append(row);
    }
    return revealOnMouseDown(box, view);
  }
}

/** Where to continue editing after a cell edit has redrawn its table (Tab to the next cell). */
/**
 * Types `text` at the caret of the table cell being edited, if there is one (the toolbar's task
 * buttons use this to put `☐` or `☑` in a cell). Returns false when no cell is being edited.
 */
export function insertInEditedCell(text: string): boolean {
  const td = document.querySelector<HTMLElement>('.cm-md-table [data-editing]');
  if (!td) return false;
  td.focus();
  const selection = window.getSelection();
  if (!selection) return false;
  if (!selection.rangeCount || !td.contains(selection.getRangeAt(0).commonAncestorContainer)) {
    selection.selectAllChildren(td);
    selection.collapseToEnd();
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  // A space on each side, so the box is not stuck to the words next to it (a space at the end
  // of the cell is dropped when the edit is saved).
  const before = document.createRange();
  before.selectNodeContents(td);
  before.setEnd(range.startContainer, range.startOffset);
  const spaced = (before.toString() && !/\s$/.test(before.toString()) ? ' ' : '') + text + ' ';
  const node = document.createTextNode(spaced);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/**
 * Types `box` into the table cell that has the cursor, when a table is shown as source: the cursor
 * is in the table's text, not in a cell being edited. A cursor outside every cell (before the
 * first `|`, say) puts the box in the next cell. Returns false when the cursor is not in a table
 * row of cells, or the row is the `| --- |` line.
 */
export function insertBoxAtCursor(view: EditorView, box: string): boolean {
  const { state } = view;
  const { from: selFrom, to: selTo, head } = state.selection.main;
  // At the very start or end of a table the cursor touches the block next to it as well.
  const inTable = ([1, -1] as const).some((side) => {
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(head, side);
    while (node && node.name !== 'Table') node = node.parent;
    return node !== null;
  });
  if (!inTable) return false;
  const line = state.doc.lineAt(head);
  if (/^[\s|:-]*$/.test(line.text)) return false;
  const cells = cellRanges(line.from, line.text);
  const cell =
    cells.find((c) => head >= c.from && head <= c.to) ?? cells.find((c) => c.from >= head);
  if (!cell) return false;
  const inside = selFrom >= cell.from && selTo <= cell.to;
  const lead = /^\s*/.exec(state.sliceDoc(cell.from, cell.to))![0].length;
  const from = inside ? selFrom : cell.from + lead;
  const to = inside ? selTo : from;
  const before = state.sliceDoc(cell.from, from);
  const after = state.sliceDoc(to, cell.to);
  const insert =
    (before.trim() && !/\s$/.test(before) ? ' ' : '') + box + (after.trim() ? ' ' : '');
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: 'input.type',
  });
  view.focus();
  return true;
}

/** Moves a block in a list item in by `indent` characters, to sit under the item's text. */
export function indentBy(el: HTMLElement, view: EditorView, indent: number): void {
  if (indent > 0) el.style.marginLeft = `calc(24px + ${indent * view.defaultCharacterWidth}px)`;
}

let resume: { pos: number; row: number; col: number } | undefined;

/**
 * A table. Clicking a cell edits that cell's text in place: while editing, the cell shows its
 * Markdown source, and leaving it (Enter, Tab, or clicking elsewhere) replaces just that cell in
 * the document (tableEdit.ts). Escape cancels. Shift+click shows the whole table's source.
 */
export class TableWidget extends WidgetType {
  constructor(
    readonly data: TableData,
    readonly indent = 0,
  ) {
    super();
  }
  eq(other: TableWidget): boolean {
    return this.indent === other.indent && JSON.stringify(this.data) === JSON.stringify(other.data);
  }
  ignoreEvent(): boolean {
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const data = this.data;
    const table = document.createElement('table');
    table.className = 'cm-md-table';
    indentBy(table, view, this.indent);
    table.setAttribute(
      'aria-label',
      l10n.t('Table, {0} columns, {1} rows', data.header.length, data.rows.length + 1),
    );
    // Row 0 is the header; the cells of each row, for moving between them.
    const grid: HTMLTableCellElement[][] = [];
    const addRow = (parent: HTMLElement, cells: Span[][], tag: 'th' | 'td', row: number) => {
      const tr = document.createElement('tr');
      const line: HTMLTableCellElement[] = [];
      cells.forEach((cell, col) => {
        const td = document.createElement(tag);
        const align = data.align[col];
        if (align) td.style.textAlign = align;
        td.dataset.row = String(row);
        td.dataset.col = String(col);
        renderSpans(cell, td);
        tr.append(td);
        line.push(td);
      });
      grid.push(line);
      parent.append(tr);
    };
    const thead = document.createElement('thead');
    addRow(thead, data.header, 'th', 0);
    const tbody = document.createElement('tbody');
    data.rows.forEach((row, i) => addRow(tbody, row, 'td', i + 1));
    table.append(thead, tbody);

    const rangeOf = (row: number, col: number) => data.ranges[row]?.[col];

    const edit = (td: HTMLTableCellElement): void => {
      const row = Number(td.dataset.row);
      const col = Number(td.dataset.col);
      const cell = rangeOf(row, col);
      if (!cell) return;
      // The cell ranges count from the start of the table, which moves when text above changes.
      const origin = view.posAtDOM(table);
      const range = { from: origin + cell.from, to: origin + cell.to };
      const original = view.state.doc.sliceString(range.from, range.to);
      const shown = [...td.childNodes];
      let finished = false;

      const restore = () => {
        td.removeAttribute('contenteditable');
        delete td.dataset.editing;
        td.replaceChildren(...shown);
      };
      /** Ends the edit; `step` moves on to the previous (-1) or next (1) cell. */
      const finish = (save: boolean, step: -1 | 0 | 1) => {
        if (finished) return;
        finished = true;
        td.removeEventListener('keydown', onKey);
        td.removeEventListener('focusout', onBlur);
        const change = save ? cellChange(range, original, td.textContent ?? '') : null;
        restore();
        let target: [number, number] | undefined;
        if (step !== 0) {
          const flat = grid.flatMap((cells, r) => cells.map((_, c) => [r, c] as [number, number]));
          const at = flat.findIndex(([r, c]) => r === row && c === col);
          target = flat[at + step];
        }
        if (change) {
          // The edit redraws the table; the new widget picks up where this one left off.
          if (target) resume = { pos: origin, row: target[0], col: target[1] };
          view.dispatch({ changes: change, userEvent: 'input.type' });
        } else if (target) {
          edit(grid[target[0]][target[1]]);
        }
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true, 0);
          view.focus();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false, 0);
          view.focus();
        } else if (event.key === 'Tab') {
          event.preventDefault();
          finish(true, event.shiftKey ? -1 : 1);
        }
      };
      const onBlur = () => finish(true, 0);

      td.dataset.editing = '1';
      td.setAttribute('contenteditable', 'plaintext-only');
      td.textContent = original.trim();
      td.addEventListener('keydown', onKey);
      td.addEventListener('focusout', onBlur);
      td.focus();
      const selection = window.getSelection();
      selection?.selectAllChildren(td);
      selection?.collapseToEnd();
    };

    table.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const td = (event.target as Element).closest<HTMLTableCellElement>('td, th');
      // Inside the cell being edited, the mouse just moves the caret.
      if (td?.dataset.editing) return;
      event.preventDefault();
      const box = (event.target as Element).closest<HTMLElement>('.cm-md-checkbox');
      if (box && td && !event.shiftKey && !view.state.readOnly) {
        // A box in the cell: `☐` to `☑` to `☒` and back (the emoji form is replaced by the plain one).
        const from = view.posAtDOM(table) + Number(box.dataset.at);
        const insert = nextBox(view.state.doc.sliceString(from, from + 1));
        view.dispatch({
          changes: { from, to: from + Number(box.dataset.length), insert },
          userEvent: 'input.type',
        });
        return;
      }
      const editable =
        td &&
        !event.shiftKey &&
        !view.state.readOnly &&
        rangeOf(Number(td.dataset.row), Number(td.dataset.col));
      if (td && editable) {
        edit(td);
      } else {
        view.dispatch({ selection: { anchor: view.posAtDOM(table) } });
        view.focus();
      }
    });

    if (resume) {
      setTimeout(() => {
        // Only the table that was being edited takes over, wherever it now is.
        if (!resume || !table.isConnected || view.posAtDOM(table) !== resume.pos) return;
        const { row, col } = resume;
        resume = undefined;
        const next = grid[row]?.[col];
        if (next?.isConnected) edit(next);
      });
    }
    return table;
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly below: boolean,
  ) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return this.src === other.src && this.alt === other.alt && this.below === other.below;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement(this.below ? 'div' : 'span');
    wrap.className = this.below ? 'cm-md-image cm-md-image-below' : 'cm-md-image';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    // The image changes the height of its line when it loads, so the editor must re-measure.
    img.addEventListener('load', () => view.requestMeasure());
    img.addEventListener('error', () => {
      wrap.className += ' cm-md-image-broken';
      wrap.textContent = this.alt || this.src;
      view.requestMeasure();
    });
    wrap.append(img);
    return revealOnMouseDown(wrap, view);
  }
}

/** The one-character edit that ticks or unticks a task: `[ ]` <-> `[x]` (PLAN.md §3.6). */
export function checkboxChange(start: number, offset: number, checked: boolean) {
  const pos = start + offset;
  return { from: pos, to: pos + 1, insert: checked ? ' ' : 'x' };
}

export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    /** Where the character between the brackets is, counted from the start of the widget. */
    readonly offset: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.offset === other.offset;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span');
    box.className = 'cm-md-checkbox' + (this.checked ? ' cm-md-checkbox-checked' : '');
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.setAttribute('aria-label', l10n.t('Task'));
    const toggle = () => {
      if (view.state.readOnly) return;
      view.dispatch({ changes: checkboxChange(view.posAtDOM(box), this.offset, this.checked) });
    };
    box.addEventListener('mousedown', (event) => {
      event.preventDefault();
      toggle();
    });
    return box;
  }
  ignoreEvent(): boolean {
    return true;
  }
}
