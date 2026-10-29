// The DOM for the block live preview widgets (see blocks.ts). Clicking a widget places the cursor
// in its source, which shows the source instead; only the checkbox handles clicks itself.

import { EditorView, WidgetType } from '@codemirror/view';
import type { Span, TableData } from './blocks';
import { cellChange } from './tableEdit';

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
  eq(): boolean {
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const hr = document.createElement('div');
    hr.className = 'cm-md-hr';
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
      `Front matter: ${this.entries.map(([key]) => key).join(', ') || 'empty'}`,
    );
    const title = document.createElement('div');
    title.className = 'cm-md-frontmatter-title';
    title.textContent = 'Front matter';
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
let resume: { pos: number; row: number; col: number } | undefined;

/**
 * A table. Clicking a cell edits that cell's text in place: while editing, the cell shows its
 * Markdown source, and leaving it (Enter, Tab, or clicking elsewhere) replaces just that cell in
 * the document (tableEdit.ts). Escape cancels. Shift+click shows the whole table's source.
 */
export class TableWidget extends WidgetType {
  constructor(readonly data: TableData) {
    super();
  }
  eq(other: TableWidget): boolean {
    return JSON.stringify(this.data) === JSON.stringify(other.data);
  }
  ignoreEvent(): boolean {
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const data = this.data;
    const table = document.createElement('table');
    table.className = 'cm-md-table';
    table.setAttribute(
      'aria-label',
      `Table, ${data.header.length} columns, ${data.rows.length + 1} rows`,
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
    box.setAttribute('aria-label', 'Task');
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
