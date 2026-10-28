// Raw HTML blocks, drawn only when `mdEditor.renderHtml` is on (PLAN.md §3.5). The HTML comes
// from the file, so it is sanitized first: no scripts, styles, forms or frames, and no link or
// image can reach outside what the editor already allows.

import { EditorView, WidgetType } from '@codemirror/view';
import DOMPurify from 'dompurify';
import { resolveImageSrc } from './images';
import { revealOnMouseDown } from './widgets';

let currentBase = '';

let hooked = false;

/** DOMPurify needs a window, so the hook is added on first use, not when the module loads. */
function addHook(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof HTMLImageElement) {
      const src = resolveImageSrc(node.getAttribute('src') ?? '', currentBase);
      if (src) node.setAttribute('src', src);
      else node.removeAttribute('src');
    } else if (node instanceof HTMLAnchorElement) {
      // A link that navigates would leave the editor; keep the target as a tooltip.
      const href = node.getAttribute('href');
      if (href) node.title = href;
      node.removeAttribute('href');
      node.removeAttribute('target');
    }
  });
}

/** The sanitized DOM for `html`; images resolve against `baseUri`. */
export function sanitizeHtml(html: string, baseUri: string): DocumentFragment {
  addHook();
  currentBase = baseUri;
  return DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta'],
    FORBID_ATTR: ['style', 'srcset'],
    ALLOW_DATA_ATTR: false,
  });
}

export class HtmlWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly baseUri: string,
  ) {
    super();
  }
  eq(other: HtmlWidget): boolean {
    return this.html === other.html && this.baseUri === other.baseUri;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-md-html';
    el.append(sanitizeHtml(this.html, this.baseUri));
    for (const img of el.querySelectorAll('img')) {
      img.addEventListener('load', () => view.requestMeasure());
    }
    return revealOnMouseDown(el, view);
  }
}
