// Entry for dist/katex.js, loaded on demand (see livePreview/lazy.ts). The import below makes
// esbuild write dist/katex.css and the font files next to it.
import katex from 'katex';
import 'katex/dist/katex.min.css';

window.mdKatex = {
  // katex.render builds DOM nodes and sets styles through the DOM, which the webview's CSP allows.
  render: (tex, element, options) =>
    katex.render(tex, element, {
      throwOnError: false,
      trust: false,
      maxExpand: 1000,
      ...options,
    }),
};
