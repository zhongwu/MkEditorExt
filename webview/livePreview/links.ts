import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

function urlText(state: EditorState, node: SyntaxNode): string {
  const url = state.doc.sliceString(node.from, node.to);
  // `[text](<url with spaces>)` keeps the angle brackets in the URL node.
  return url.startsWith('<') && url.endsWith('>') ? url.slice(1, -1) : url;
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Finds the URL of a `[label]: url` definition anywhere in the document. */
function resolveReference(state: EditorState, label: string): string | undefined {
  const wanted = normalizeLabel(label);
  let found: string | undefined;
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (found !== undefined) return false;
      if (ref.name !== 'LinkReference') return;
      const node = ref.node;
      const labelNode = node.getChild('LinkLabel');
      const url = node.getChild('URL');
      if (labelNode && url) {
        const text = state.doc.sliceString(labelNode.from + 1, labelNode.to - 1);
        if (normalizeLabel(text) === wanted) found = urlText(state, url);
      }
      return false;
    },
  });
  return found;
}

function linkTarget(state: EditorState, node: SyntaxNode): string | undefined {
  const url = node.getChild('URL');
  if (url) return urlText(state, url);
  // Reference link: `[text][label]`, `[label][]` or `[label]`.
  const label = node.getChild('LinkLabel');
  if (label && label.to - label.from > 2) {
    return resolveReference(state, state.doc.sliceString(label.from + 1, label.to - 1));
  }
  const marks = node.getChildren('LinkMark');
  if (marks.length >= 2) {
    return resolveReference(state, state.doc.sliceString(marks[0].to, marks[1].from));
  }
  return undefined;
}

/** The target of the link at `pos`, if there is one. */
export function linkAt(state: EditorState, pos: number): string | undefined {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      switch (node.name) {
        case 'Link':
        case 'Image':
        case 'Autolink':
          return linkTarget(state, node);
        case 'URL':
          if (node.parent?.name === 'LinkReference') return undefined;
          if (node.parent?.name === 'Paragraph' || node.parent?.name === 'TableCell') {
            return urlText(state, node);
          }
          break;
      }
    }
  }
  return undefined;
}
