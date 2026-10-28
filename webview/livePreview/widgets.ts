// The DOM for the block live preview widgets (see blocks.ts). Clicking a widget places the cursor
// in its source, which shows the source instead; only the checkbox handles clicks itself.

import { EditorView, WidgetType } from '@codemirror/view';
import type { Span, TableData } from './blocks';

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

export class TableWidget extends WidgetType {
  constructor(readonly data: TableData) {
    super();
  }
  eq(other: TableWidget): boolean {
    return JSON.stringify(this.data) === JSON.stringify(other.data);
  }
  toDOM(view: EditorView): HTMLElement {
    const table = document.createElement('table');
    table.className = 'cm-md-table';
    table.setAttribute(
      'aria-label',
      `Table, ${this.data.header.length} columns, ${this.data.rows.length + 1} rows`,
    );
    const addRow = (parent: HTMLElement, cells: Span[][], tag: 'th' | 'td') => {
      const tr = document.createElement('tr');
      cells.forEach((cell, i) => {
        const td = document.createElement(tag);
        const align = this.data.align[i];
        if (align) td.style.textAlign = align;
        renderSpans(cell, td);
        tr.append(td);
      });
      parent.append(tr);
    };
    const thead = document.createElement('thead');
    addRow(thead, this.data.header, 'th');
    const tbody = document.createElement('tbody');
    for (const row of this.data.rows) addRow(tbody, row, 'td');
    table.append(thead, tbody);
    return revealOnMouseDown(table, view);
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
      // A one-character edit: [ ] <-> [x]. Nothing else in the line changes (PLAN.md §3.6).
      if (view.state.readOnly) return;
      const pos = view.posAtDOM(box) + this.offset;
      view.dispatch({ changes: { from: pos, to: pos + 1, insert: this.checked ? ' ' : 'x' } });
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
