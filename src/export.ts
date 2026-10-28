// Export to HTML (PLAN.md §5, Phase 5): markdown-it turns the document into a standalone page.
// It is not used for editing. No dependency on the `vscode` module, so it can be unit-tested.
//
// Raw HTML in the Markdown is escaped, not passed through (`html: false`), and markdown-it
// refuses `javascript:` and similar link targets, so the page cannot contain script from the
// document. A Content Security Policy in the page blocks scripts as well.

import katex from 'katex';
import sanitizeHtml from 'sanitize-html';
import MarkdownIt, {
  type Env as MarkdownItEnv,
  type StateBlock,
  type StateCore,
  type StateInline,
  type Token,
} from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { slugify } from './headings';

export interface ExportOptions {
  /** The page title; defaults to the first heading. */
  title?: string;
  /** Local images to embed, by the `src` written in the Markdown. Others are left as links. */
  images?: ReadonlyMap<string, { mime: string; data: Uint8Array }>;
  /** KaTeX's stylesheet with its fonts inlined; added only if the document has math. */
  katexCss?: string;
  /** Pass raw HTML blocks through, sanitized (`mdEditor.renderHtml`); otherwise they are shown as text. */
  rawHtml?: boolean;
  /** Mermaid diagrams as SVG, by their source. Diagrams not listed are shown as code. */
  diagrams?: ReadonlyMap<string, string>;
}

const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;

/** Raw HTML with scripts, styles, forms, frames and event handlers removed; only web links stay. */
function sanitizeRawHtml(html: string, options: ExportOptions): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img',
      'picture',
      'details',
      'summary',
      'figure',
      'figcaption',
      'kbd',
      'sub',
      'sup',
      'mark',
    ]),
    allowedAttributes: {
      a: ['href', 'title', 'name'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      '*': ['align', 'colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    transformTags: {
      img: (tagName, attribs) => {
        const embedded = attribs.src ? options.images?.get(attribs.src) : undefined;
        if (embedded) {
          const base64 = Buffer.from(embedded.data).toString('base64');
          attribs.src = `data:${embedded.mime};base64,${base64}`;
        }
        return { tagName, attribs };
      },
    },
  });
}

const ALERTS: Record<string, string> = {
  NOTE: 'Note',
  TIP: 'Tip',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
};

interface Env extends MarkdownItEnv {
  usesMath?: boolean;
}

function renderMath(tex: string, displayMode: boolean, env: Env): string {
  env.usesMath = true;
  return katex.renderToString(tex, { displayMode, throwOnError: false, output: 'htmlAndMathml' });
}

/** `$x$` inside a paragraph, with GitHub's rules: no space inside the dollars, no digit after. */
function inlineMath(state: StateInline, silent: boolean): boolean {
  const { src, pos, posMax } = state;
  if (src[pos] !== '$' || src[pos + 1] === '$' || pos + 1 >= posMax || /\s/.test(src[pos + 1])) {
    return false;
  }
  let end = pos + 1;
  while ((end = src.indexOf('$', end)) !== -1 && end < posMax && src[end - 1] === '\\') end++;
  if (end === -1 || end >= posMax || end === pos + 1) return false;
  if (/\s/.test(src[end - 1]) || /\d/.test(src[end + 1] ?? '')) return false;
  if (!silent) {
    state.push('math_inline', 'math', 0).content = src.slice(pos + 1, end);
  }
  state.pos = end + 1;
  return true;
}

/** `$$ … $$`, on one line or with the dollars on lines of their own. */
function blockMath(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const first = state.src.slice(
    state.bMarks[startLine] + state.tShift[startLine],
    state.eMarks[startLine],
  );
  if (state.sCount[startLine] - state.blkIndent >= 4 || !first.startsWith('$$')) return false;
  const lines: string[] = [];
  let line = startLine;
  let rest = first.slice(2);
  if (rest.trimEnd().endsWith('$$') && rest.trim().length > 2) {
    lines.push(rest.trimEnd().slice(0, -2));
  } else {
    if (rest.trim() !== '') lines.push(rest);
    let closed = false;
    while (++line < endLine) {
      rest = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
      if (rest.trimEnd().endsWith('$$')) {
        const before = rest.trimEnd().slice(0, -2);
        if (before.trim() !== '') lines.push(before);
        closed = true;
        break;
      }
      lines.push(rest);
    }
    if (!closed) return false;
  }
  if (silent) return true;
  state.line = line + 1;
  const token = state.push('math_block', 'math', 0);
  token.content = lines.join('\n');
  token.map = [startLine, state.line];
  return true;
}

/** `- [ ] task` and `- [x] done`: a disabled checkbox replaces the marker. */
function taskLists(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (
      inline.type !== 'inline' ||
      tokens[i - 1].type !== 'paragraph_open' ||
      tokens[i - 2].type !== 'list_item_open'
    ) {
      continue;
    }
    const match = /^\[([ xX])\][ \t]+/.exec(inline.content);
    const first = inline.children?.[0];
    if (!match || first?.type !== 'text') continue;
    first.content = first.content.replace(/^\[[ xX]\][ \t]+/, '');
    const box = new state.Token('html_inline', '', 0);
    box.content = `<input type="checkbox" disabled${match[1] === ' ' ? '' : ' checked'}> `;
    inline.children?.unshift(box);
    tokens[i - 2].attrJoin('class', 'task-list-item');
  }
}

/** GitHub alerts: a quote whose first line is `[!NOTE]`, `[!TIP]` and so on. */
function alerts(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i].type !== 'blockquote_open' || tokens[i + 1].type !== 'paragraph_open') continue;
    const inline = tokens[i + 2];
    const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i.exec(inline.content);
    const first = inline.children?.[0];
    if (!match || first?.type !== 'text') continue;
    const kind = match[1].toUpperCase();
    // Drop the marker and the line break after it.
    first.content = first.content.replace(/^\[![A-Za-z]+\][ \t]*/, '');
    if (first.content === '' && inline.children?.[1]?.type === 'softbreak') {
      inline.children.splice(0, 2);
    } else if (first.content === '') {
      inline.children?.shift();
    }
    tokens[i].attrJoin('class', `alert alert-${kind.toLowerCase()}`);
    const title = new state.Token('html_block', '', 0);
    title.content = `<p class="alert-title">${ALERTS[kind]}</p>\n`;
    tokens.splice(i + 1, 0, title);
  }
}

/** GitHub's anchors on headings, so `#some-heading` links in the document work. */
function headingIds(state: StateCore): void {
  const seen = new Map<string, number>();
  const tokens = state.tokens;
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    const base = slugify(tokens[i + 1].content);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    tokens[i].attrSet('id', count === 0 ? base : `${base}-${count}`);
  }
}

function createParser(options: ExportOptions) {
  const md = new MarkdownIt({ html: options.rawHtml === true, linkify: true });
  md.use(footnote);
  if (options.rawHtml) {
    // Blocks are sanitized whole; a lone inline tag could not be matched with its partner.
    md.renderer.rules.html_block = (tokens, i) => sanitizeRawHtml(tokens[i].content, options);
    md.renderer.rules.html_inline = (tokens, i) => escapeHtml(tokens[i].content);
  }
  md.inline.ruler.after('escape', 'math_inline', inlineMath);
  md.block.ruler.before('fence', 'math_block', blockMath, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.core.ruler.push('task_lists', taskLists);
  md.core.ruler.push('alerts', alerts);
  md.core.ruler.push('heading_ids', headingIds);

  md.renderer.rules.math_inline = (tokens, i, _o, env) =>
    renderMath(tokens[i].content, false, env as Env);
  md.renderer.rules.math_block = (tokens, i, _o, env) =>
    `<div class="math-block">${renderMath(tokens[i].content, true, env as Env)}</div>\n`;

  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, i, o, env, self) => {
    const svg = isMermaid(tokens[i]) ? options.diagrams?.get(tokens[i].content) : undefined;
    if (svg) {
      return `<div class="diagram" role="img" aria-label="Mermaid diagram">${svg}</div>\n`;
    }
    if (tokens[i].info.trim().toLowerCase() === 'math') {
      return `<div class="math-block">${renderMath(tokens[i].content, true, env as Env)}</div>\n`;
    }
    return fence(tokens, i, o, env, self);
  };

  const image = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, i, o, env, self) => {
    const src = String(tokens[i].attrGet('src') ?? '');
    const embedded = options.images?.get(src);
    if (embedded) {
      const base64 = Buffer.from(embedded.data).toString('base64');
      tokens[i].attrSet('src', `data:${embedded.mime};base64,${base64}`);
    }
    return image(tokens, i, o, env, self);
  };
  return md;
}

function isMermaid(token: Token): boolean {
  return token.info.trim().split(/\s/)[0].toLowerCase() === 'mermaid';
}

/** The source of every Mermaid diagram in the document, once each. */
export function collectDiagramSources(markdown: string): string[] {
  const sources = new Set<string>();
  for (const token of createParser({}).parse(stripFrontMatter(markdown), {})) {
    if (token.type === 'fence' && isMermaid(token)) sources.add(token.content);
  }
  return [...sources];
}

/** The `src` of every image in the document, so the caller can read the local ones. */
export function collectImageSources(markdown: string, rawHtml = false): string[] {
  const sources = new Set<string>();
  const visit = (tokens: readonly Token[]) => {
    for (const token of tokens) {
      if (rawHtml && token.type === 'html_block') {
        for (const [, src] of token.content.matchAll(IMG_SRC)) sources.add(src);
      }
      if (token.type === 'image') {
        const src = token.attrGet('src');
        if (src) sources.add(String(src));
      }
      if (token.children) visit(token.children);
    }
  };
  visit(createParser({ rawHtml }).parse(stripFrontMatter(markdown), {}));
  return [...sources];
}

function stripFrontMatter(markdown: string): string {
  return markdown.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE = `
:root { color-scheme: light dark; --fg: #1f2328; --bg: #ffffff; --muted: #59636e; --line: #d1d9e0; --code: #f6f8fa; --link: #0969da; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --bg: #0d1117; --muted: #9198a1; --line: #3d444d; --code: #151b23; --link: #4493f8; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
article { max-width: 860px; margin: 0 auto; padding: 32px 24px 64px; overflow-wrap: break-word; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.6em; }
h1, h2 { padding-bottom: 0.3em; border-bottom: 1px solid var(--line); }
a { color: var(--link); }
img { max-width: 100%; }
code, pre { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 0.9em; }
code { background: var(--code); padding: 0.15em 0.35em; border-radius: 4px; }
pre { background: var(--code); padding: 12px 16px; border-radius: 6px; overflow: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 1em 0; padding: 0 1em; color: var(--muted); border-left: 4px solid var(--line); }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid var(--line); padding: 6px 13px; }
th { background: var(--code); }
hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
li.task-list-item { list-style: none; margin-left: -1.4em; }
.math-block { overflow-x: auto; margin: 1em 0; }
.diagram { overflow-x: auto; margin: 1em 0; padding: 12px; text-align: center; background: #ffffff; border-radius: 6px; }
.diagram svg { max-width: 100%; height: auto; }
.alert { color: var(--fg); border-left-width: 4px; }
.alert-title { font-weight: 600; margin: 0.6em 0 0; }
.alert-note { border-left-color: #0969da; } .alert-tip { border-left-color: #1a7f37; }
.alert-important { border-left-color: #8250df; } .alert-warning { border-left-color: #9a6700; }
.alert-caution { border-left-color: #cf222e; }
.footnotes { font-size: 0.9em; color: var(--muted); }
@media print {
  :root { --fg: #1f2328; --bg: #ffffff; --muted: #59636e; --line: #d1d9e0; --code: #f6f8fa; --link: #0969da; }
  article { max-width: none; padding: 0; }
  pre { white-space: pre-wrap; }
  pre, blockquote, table, img, .diagram, .math-block, tr { break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
}
`;

/** The Markdown as one self-contained HTML page. */
export function renderHtml(markdown: string, options: ExportOptions = {}): string {
  const body = stripFrontMatter(markdown);
  const env: Env = {};
  const md = createParser(options);
  const article = md.render(body, env);
  const title =
    options.title ??
    /^#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(body)?.[1].replace(/[*_`~]/g, '') ??
    'Document';
  const csp = "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}${env.usesMath ? (options.katexCss ?? '') : ''}</style>
</head>
<body>
<article>
${article}</article>
</body>
</html>
`;
}
