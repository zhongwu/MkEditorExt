// VS Code-style floating Find & Replace panel for CodeMirror's @codemirror/search.

import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from '@codemirror/search';
import { EditorView, type Panel, type ViewUpdate, runScopeHandlers } from '@codemirror/view';
import { l10n } from './l10n';

const MAX_MATCH_COUNT = 1000;
const expandedPanels = new WeakMap<EditorView, { setExpanded(open: boolean, focus?: boolean): void }>();

const svg = (paths: string, viewBox = '0 0 16 16') =>
  `<svg viewBox="${viewBox}" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  chevronRight: svg('<path d="M6 4l4 4-4 4"/>'),
  chevronDown: svg('<path d="M4 6l4 4 4-4"/>'),
  prev: svg('<path d="M8 12.5V3.5M4.5 7L8 3.5 11.5 7"/>'),
  next: svg('<path d="M8 3.5v9M4.5 9L8 12.5 11.5 9"/>'),
  close: svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>'),
  replace: svg('<path d="M3 5h6M6 2.5L3.5 5 6 7.5M13 11H7M10 8.5l2.5 2.5L10 13.5"/>'),
  replaceAll: svg(
    '<path d="M2.5 4.5h5M5 2.5L3 4.5 5 6.5M8.5 8.5h5M11 6.5l2 2-2 2M2.5 12h8"/>',
  ),
};

function countMatches(view: EditorView, query: SearchQuery): { total: number; current: number } {
  if (!query.valid || !query.search) return { total: 0, current: 0 };
  const { from, to } = view.state.selection.main;
  let total = 0;
  let current = 0;
  const cursor = query.getCursor(view.state.doc);
  for (let item = cursor.next(); !item.done; item = cursor.next()) {
    total++;
    if (item.value.from === from && item.value.to === to) {
      current = total;
    }
    if (total >= MAX_MATCH_COUNT) break;
  }
  return { total, current };
}

function makeIconButton(
  label: string,
  iconHtml: string,
  onClick: () => void,
  className = 'cm-vsc-btn',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.innerHTML = iconHtml;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.addEventListener('click', onClick);
  return button;
}

function makeOptionButton(
  text: string,
  label: string,
  initial: boolean,
  onToggle: () => void,
  className = '',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `cm-vsc-opt ${className}`.trim();
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(initial));
  button.title = label;
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(next));
    onToggle();
  });
  return button;
}

/** Creates a VS Code-style floating Find & Replace panel. */
export function createVscodeSearchPanel(view: EditorView): Panel {
  let query = getSearchQuery(view.state);
  let expanded = false;

  const dom = document.createElement('div');
  dom.className = 'cm-vscode-search';
  dom.setAttribute('role', 'region');
  dom.setAttribute('aria-label', l10n.t('Find and replace'));

  // Left chevron to expand/collapse the Replace row.
  const toggleBtn = makeIconButton(
    l10n.t('Toggle Replace'),
    ICONS.chevronRight,
    () => setExpanded(!expanded, expanded ? false : true),
    'cm-vsc-toggle',
  );
  toggleBtn.setAttribute('aria-expanded', 'false');

  const body = document.createElement('div');
  body.className = 'cm-vsc-body';

  // --- Find row ---
  const findRow = document.createElement('div');
  findRow.className = 'cm-vsc-row';

  const findBox = document.createElement('div');
  findBox.className = 'cm-vsc-input-wrap';

  const searchField = document.createElement('input');
  searchField.type = 'text';
  searchField.className = 'cm-vsc-input';
  searchField.name = 'search';
  searchField.value = query.search;
  searchField.placeholder = l10n.t('Find');
  searchField.setAttribute('aria-label', l10n.t('Find'));
  searchField.setAttribute('main-field', 'true');

  const commit = () => {
    const next = new SearchQuery({
      search: searchField.value,
      caseSensitive: caseBtn.getAttribute('aria-pressed') === 'true',
      wholeWord: wordBtn.getAttribute('aria-pressed') === 'true',
      regexp: reBtn.getAttribute('aria-pressed') === 'true',
      replace: replaceField.value,
    });
    if (!next.eq(query)) {
      query = next;
      view.dispatch({ effects: setSearchQuery.of(next) });
    }
    updateCount();
  };

  const caseBtn = makeOptionButton('Aa', l10n.t('Match Case'), query.caseSensitive, commit);
  const wordBtn = makeOptionButton(
    'ab',
    l10n.t('Match Whole Word'),
    query.wholeWord,
    commit,
    'cm-vsc-word',
  );
  const reBtn = makeOptionButton('.*', l10n.t('Use Regular Expression'), query.regexp, commit);

  const options = document.createElement('div');
  options.className = 'cm-vsc-options';
  options.append(caseBtn, wordBtn, reBtn);
  findBox.append(searchField, options);

  const countEl = document.createElement('span');
  countEl.className = 'cm-vsc-count';
  countEl.setAttribute('aria-live', 'polite');

  const prevBtn = makeIconButton(l10n.t('Previous Match'), ICONS.prev, () => findPrevious(view));
  const nextBtn = makeIconButton(l10n.t('Next Match'), ICONS.next, () => findNext(view));
  const closeBtn = makeIconButton(l10n.t('Close'), ICONS.close, () => closeSearchPanel(view));

  findRow.append(findBox, countEl, prevBtn, nextBtn, closeBtn);

  // --- Replace row ---
  const replaceRow = document.createElement('div');
  replaceRow.className = 'cm-vsc-row cm-vsc-replace-row';

  const replaceBox = document.createElement('div');
  replaceBox.className = 'cm-vsc-input-wrap';

  const replaceField = document.createElement('input');
  replaceField.type = 'text';
  replaceField.className = 'cm-vsc-input';
  replaceField.name = 'replace';
  replaceField.value = query.replace;
  replaceField.placeholder = l10n.t('Replace');
  replaceField.setAttribute('aria-label', l10n.t('Replace'));

  replaceBox.append(replaceField);

  const replaceBtn = makeIconButton(l10n.t('Replace'), ICONS.replace, () => replaceNext(view));
  const replaceAllBtn = makeIconButton(l10n.t('Replace All'), ICONS.replaceAll, () =>
    replaceAll(view),
  );

  replaceRow.append(replaceBox, replaceBtn, replaceAllBtn);
  body.append(findRow, replaceRow);
  dom.append(toggleBtn, body);

  const syncReadOnly = () => {
    const ro = view.state.readOnly;
    toggleBtn.hidden = ro;
    replaceRow.hidden = ro || !expanded;
  };

  const setExpanded = (open: boolean, focusReplace = false) => {
    expanded = open && !view.state.readOnly;
    toggleBtn.setAttribute('aria-expanded', String(expanded));
    toggleBtn.innerHTML = expanded ? ICONS.chevronDown : ICONS.chevronRight;
    syncReadOnly();
    if (focusReplace && expanded && searchField.value) {
      replaceField.focus();
      replaceField.select();
    }
  };

  const updateCount = () => {
    const text = searchField.value;
    if (!text) {
      countEl.textContent = '';
      countEl.classList.remove('cm-vsc-count-none');
      findBox.classList.remove('cm-vsc-input-error');
      return;
    }
    if (!query.valid) {
      countEl.textContent = l10n.t('Invalid pattern');
      countEl.classList.add('cm-vsc-count-none');
      findBox.classList.add('cm-vsc-input-error');
      return;
    }
    findBox.classList.remove('cm-vsc-input-error');
    const { total, current } = countMatches(view, query);
    if (total === 0) {
      countEl.textContent = l10n.t('No results');
      countEl.classList.add('cm-vsc-count-none');
    } else {
      countEl.classList.remove('cm-vsc-count-none');
      const totalLabel = total >= MAX_MATCH_COUNT ? `${MAX_MATCH_COUNT - 1}+` : String(total);
      countEl.textContent =
        current > 0
          ? l10n.t('{0} of {1}', current, totalLabel)
          : l10n.t('{0} results', totalLabel);
    }
  };

  searchField.addEventListener('input', commit);
  replaceField.addEventListener('input', commit);

  dom.addEventListener('keydown', (event) => {
    if (runScopeHandlers(view, event, 'search-panel')) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && event.target === searchField) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(view);
    } else if (event.key === 'Enter' && event.target === replaceField) {
      event.preventDefault();
      replaceNext(view);
    }
  });

  expandedPanels.set(view, { setExpanded });
  syncReadOnly();
  updateCount();

  return {
    top: true,
    dom,
    mount() {
      searchField.focus();
      searchField.select();
      updateCount();
    },
    update(update: ViewUpdate) {
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery) && !effect.value.eq(query)) {
            query = effect.value;
            searchField.value = query.search;
            replaceField.value = query.replace;
            caseBtn.setAttribute('aria-pressed', String(query.caseSensitive));
            wordBtn.setAttribute('aria-pressed', String(query.wholeWord));
            reBtn.setAttribute('aria-pressed', String(query.regexp));
          }
        }
      }
      if (update.docChanged || update.selectionSet || update.transactions.length > 0) {
        syncReadOnly();
        updateCount();
      }
    },
  };
}

/** Opens the Find & Replace panel, optionally expanded to show Replace. */
export function openFindPanel(view: EditorView, withReplace: boolean): boolean {
  openSearchPanel(view);
  expandedPanels.get(view)?.setExpanded(withReplace, withReplace);
  return true;
}

export const searchPanelTheme = EditorView.theme({
  '.cm-panels-top': {
    position: 'absolute',
    top: '4px',
    right: '16px',
    left: 'auto',
    zIndex: '10',
    backgroundColor: 'transparent',
    border: 'none',
    maxWidth: 'calc(100% - 32px)',
  },
  '.cm-vscode-search': {
    display: 'flex',
    alignItems: 'stretch',
    gap: '4px',
    padding: '4px 6px 4px 4px',
    backgroundColor: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
    color: 'var(--vscode-editorWidget-foreground, var(--vscode-foreground))',
    border: '1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent))',
    borderRadius: '4px',
    boxShadow: '0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36))',
    fontFamily: 'var(--vscode-font-family)',
    fontSize: 'var(--vscode-font-size)',
  },
  '.cm-vsc-toggle': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    padding: '0',
    border: 'none',
    borderRadius: '3px',
    background: 'transparent',
    color: 'var(--vscode-foreground)',
    cursor: 'pointer',
    flexShrink: '0',
  },
  '.cm-vsc-toggle:hover': {
    backgroundColor: 'var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground))',
  },
  '.cm-vsc-toggle[hidden], .cm-vsc-replace-row[hidden]': {
    display: 'none',
  },
  '.cm-vsc-body': {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: '0',
  },
  '.cm-vsc-row': {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  '.cm-vsc-input-wrap': {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'var(--vscode-input-background)',
    border: '1px solid var(--vscode-input-border, transparent)',
    borderRadius: '2px',
    padding: '1px 2px',
    width: '220px',
    boxSizing: 'border-box',
  },
  '.cm-vsc-input-wrap:focus-within': {
    borderColor: 'var(--vscode-focusBorder)',
  },
  '.cm-vsc-input-wrap.cm-vsc-input-error': {
    borderColor: 'var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground))',
  },
  '.cm-vsc-input': {
    flex: '1',
    minWidth: '0',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: 'var(--vscode-input-foreground)',
    fontFamily: 'inherit',
    fontSize: '12px',
    padding: '2px 4px',
  },
  '.cm-vsc-input::placeholder': {
    color: 'var(--vscode-input-placeholderForeground)',
  },
  '.cm-vsc-options': {
    display: 'flex',
    alignItems: 'center',
    gap: '1px',
  },
  '.cm-vsc-opt': {
    minWidth: '20px',
    height: '20px',
    padding: '0 3px',
    border: '1px solid transparent',
    borderRadius: '3px',
    background: 'transparent',
    color: 'var(--vscode-foreground)',
    fontFamily: 'inherit',
    fontSize: '11px',
    lineHeight: '1',
    cursor: 'pointer',
  },
  '.cm-vsc-word': {
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  '.cm-vsc-opt:hover': {
    backgroundColor: 'var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground))',
  },
  '.cm-vsc-opt[aria-pressed="true"]': {
    backgroundColor: 'var(--vscode-inputOption-activeBackground, rgba(0, 122, 204, 0.3))',
    borderColor: 'var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder))',
    color: 'var(--vscode-inputOption-activeForeground, var(--vscode-foreground))',
  },
  '.cm-vsc-count': {
    padding: '0 6px',
    fontSize: '11px',
    color: 'var(--vscode-descriptionForeground)',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  '.cm-vsc-count:empty': {
    display: 'none',
  },
  '.cm-vsc-count-none': {
    color: 'var(--vscode-errorForeground)',
  },
  '.cm-vsc-btn': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    padding: '0',
    border: 'none',
    borderRadius: '3px',
    background: 'transparent',
    color: 'var(--vscode-foreground)',
    cursor: 'pointer',
  },
  '.cm-vsc-btn:hover': {
    backgroundColor: 'var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground))',
  },
  '.cm-vsc-btn:focus-visible, .cm-vsc-toggle:focus-visible, .cm-vsc-opt:focus-visible': {
    outline: '1px solid var(--vscode-focusBorder)',
    outlineOffset: '-1px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.33))',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'var(--vscode-editor-findMatchBackground, rgba(255, 150, 50, 0.6))',
  },
});
