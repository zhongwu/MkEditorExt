// Publishes the packages that dist/languages.js must share with this bundle (see esbuild.mjs).
// It runs when the bundle loads, before the languages bundle can be requested.

import * as state from '@codemirror/state';
import * as view from '@codemirror/view';
import * as language from '@codemirror/language';
import * as common from '@lezer/common';
import * as highlight from '@lezer/highlight';
import * as lr from '@lezer/lr';
import * as markdown from '@lezer/markdown';

window.mdShared = {
  '@codemirror/state': state,
  '@codemirror/view': view,
  '@codemirror/language': language,
  '@lezer/common': common,
  '@lezer/highlight': highlight,
  '@lezer/lr': lr,
  '@lezer/markdown': markdown,
};
