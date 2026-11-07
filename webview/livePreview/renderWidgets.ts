// Widgets for math and Mermaid diagrams. Both libraries load on first use (see lazy.ts); until
// then, and if loading or rendering fails, the widget shows the source text.

import { EditorView, WidgetType } from '@codemirror/view';
import { loadKatex, loadMermaid } from './lazy';
import { l10n } from '../l10n';
import { indentBy, revealOnMouseDown } from './widgets';

export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly indent = 0,
  ) {
    super();
  }
  eq(other: MathWidget): boolean {
    return this.tex === other.tex && this.display === other.display && this.indent === other.indent;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'cm-md-math cm-md-math-display' : 'cm-md-math';
    el.textContent = this.tex;
    if (this.display) indentBy(el, this.indent);
    loadKatex()
      .then((katex) => {
        el.textContent = '';
        katex.render(this.tex, el, { displayMode: this.display });
      })
      .catch(() => el.classList.add('cm-md-math-error'))
      .finally(() => view.requestMeasure());
    return revealOnMouseDown(el, view);
  }
}

const svgCache = new Map<string, string>();
let renderQueue: Promise<unknown> = Promise.resolve();
let renderCount = 0;

function mermaidTheme(): string {
  const classes = document.body.classList;
  const dark = classes.contains('vscode-dark') || classes.contains('vscode-high-contrast');
  return dark && !classes.contains('vscode-high-contrast-light') ? 'dark' : 'default';
}

/** Renders one diagram at a time, since Mermaid keeps global state while it renders. */
function renderDiagram(source: string, theme: string): Promise<string> {
  const key = `${theme}\n${source}`;
  const cached = svgCache.get(key);
  if (cached) return Promise.resolve(cached);
  const run = async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({ theme });
    const id = `md-mermaid-${renderCount++}`;
    try {
      const { svg } = await mermaid.render(id, source);
      svgCache.set(key, svg);
      return svg;
    } finally {
      // A failed render can leave its temporary element in the page.
      document.getElementById(`d${id}`)?.remove();
    }
  };
  const result = renderQueue.then(run, run);
  renderQueue = result.catch(() => undefined);
  return result;
}

/** Draws diagrams for the export, in the light theme the exported page shows them on. */
export function drawDiagrams(sources: string[]): Promise<(string | null)[]> {
  return Promise.all(sources.map((source) => renderDiagram(source, 'default').catch(() => null)));
}

export class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly indent = 0,
  ) {
    super();
  }
  eq(other: MermaidWidget): boolean {
    return this.source === other.source && this.indent === other.indent;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-md-mermaid';
    indentBy(el, this.indent);
    el.setAttribute('role', 'img');
    el.setAttribute(
      'aria-label',
      l10n.t('Mermaid diagram: {0}', this.source.replace(/\s+/g, ' ').trim().slice(0, 200)),
    );
    el.textContent = l10n.t('Rendering diagram…');
    renderDiagram(this.source, mermaidTheme())
      .then((svg) => {
        el.className = 'cm-md-mermaid cm-md-mermaid-done';
        // Mermaid's "strict" security level has already sanitized the diagram's text.
        el.innerHTML = svg;
      })
      .catch((error: unknown) => {
        el.className = 'cm-md-mermaid cm-md-mermaid-error';
        const message = error instanceof Error ? error.message : String(error);
        el.textContent = l10n.t('Diagram could not be drawn: {0}', message.split('\n')[0]);
      })
      .finally(() => view.requestMeasure());
    return revealOnMouseDown(el, view);
  }
}
