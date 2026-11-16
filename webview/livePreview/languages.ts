// The Markdown language, with the syntax highlighting for fenced code blocks loaded on demand
// (PLAN.md §5, Phase 3). The ~1 MB of language definitions is a separate bundle that is only
// loaded once a document has a fenced block with a language name.

import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { LanguageDescription } from '@codemirror/language';
import { Compartment, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { highlightCode, tagHighlighter, tags } from '@lezer/highlight';
import type { MarkdownExtension } from '@lezer/markdown';
import { loadLanguages } from './lazy';

/** Fence names drawn as diagrams or formulas, not highlighted as code. */
const NOT_CODE = new Set(['math', 'mermaid', 'dot', 'graphviz', 'vega-lite']);

const exportHighlighter = tagHighlighter([
  { tag: tags.keyword, class: 'tok-keyword' },
  { tag: [tags.string, tags.regexp], class: 'tok-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'tok-number' },
  { tag: tags.comment, class: 'tok-comment' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: 'tok-function',
  },
  { tag: tags.typeName, class: 'tok-type' },
]);

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Highlights fenced code blocks using the lazy language bundle, for HTML and PDF exports. */
export async function highlightCodeBlocks(
  blocks: readonly { lang: string; code: string }[],
): Promise<(string | null)[]> {
  if (blocks.length === 0) return [];
  let loaded: readonly LanguageDescription[];
  try {
    loaded = await loadLanguages();
  } catch {
    return blocks.map(() => null);
  }
  return Promise.all(
    blocks.map(async ({ lang, code }) => {
      const desc = LanguageDescription.matchLanguageName(loaded, lang, true);
      if (!desc) return null;
      try {
        const support = await desc.load();
        const tree = support.language.parser.parse(code);
        let out = '';
        highlightCode(
          code,
          tree,
          exportHighlighter,
          (text, classes) => {
            const escaped = escapeHtmlText(text);
            out += classes ? `<span class="${classes}">${escaped}</span>` : escaped;
          },
          () => {
            out += '\n';
          },
        );
        return out;
      } catch {
        return null;
      }
    }),
  );
}

export function lazyMarkdown(extensions: MarkdownExtension[]): {
  extension: Extension;
  /** Call once the editor exists, so a finished load can re-highlight it. */
  attach(view: EditorView): void;
} {
  const compartment = new Compartment();
  let view: EditorView | undefined;
  let languages: readonly LanguageDescription[] | undefined;
  let loading = false;

  const build = () =>
    markdown({ base: markdownLanguage, codeLanguages: lookup, extensions }) as Extension;

  function lookup(info: string): LanguageDescription | null {
    if (languages) {
      return LanguageDescription.matchLanguageName(languages, info, true);
    }
    const name = info.trim().toLowerCase();
    if (!loading && name && !NOT_CODE.has(name)) {
      loading = true;
      loadLanguages().then(
        (loaded) => {
          languages = loaded;
          // A new language object makes CodeMirror parse the document again, now with languages.
          view?.dispatch({ effects: compartment.reconfigure(build()) });
        },
        () => {
          loading = false;
        },
      );
    }
    return null;
  }

  return {
    extension: compartment.of(build()),
    attach(v) {
      view = v;
    },
  };
}
