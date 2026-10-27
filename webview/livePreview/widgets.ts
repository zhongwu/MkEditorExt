// The DOM for the block live preview widgets (see blocks.ts). Clicking a widget places the cursor
// in its source, which shows the source instead; only the checkbox handles clicks itself.

import { EditorView, WidgetType } from '@codemirror/view';
import type { Span, TableData } from './blocks';

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
  toDOM(): HTMLElement {
    const hr = document.createElement('div');
    hr.className = 'cm-md-hr';
    return hr;
  }
}

export class FrontMatterWidget extends WidgetType {
  constructor(readonly entries: readonly [string, string][]) {
    super();
  }
  eq(other: FrontMatterWidget): boolean {
    return JSON.stringify(this.entries) === JSON.stringify(other.entries);
  }
  toDOM(): HTMLElement {
    const box = document.createElement('div');
    box.className = 'cm-md-frontmatter';
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
    return box;
  }
}

export class TableWidget extends WidgetType {
  constructor(readonly data: TableData) {
    super();
  }
  eq(other: TableWidget): boolean {
    return JSON.stringify(this.data) === JSON.stringify(other.data);
  }
  toDOM(): HTMLElement {
    const table = document.createElement('table');
    table.className = 'cm-md-table';
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
    return wrap;
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
    box.addEventListener('mousedown', (event) => {
      // A one-character edit: [ ] <-> [x]. Nothing else in the line changes (PLAN.md §3.6).
      event.preventDefault();
      const pos = view.posAtDOM(box) + this.offset;
      view.dispatch({ changes: { from: pos, to: pos + 1, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }
  ignoreEvent(): boolean {
    return true;
  }
}
