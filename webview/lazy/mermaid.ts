// Entry for dist/mermaid.js, loaded on demand (see livePreview/lazy.ts).
import mermaid from 'mermaid';

const base = { startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true } as const;

mermaid.initialize(base);

window.mdMermaid = {
  render: (id, source) => mermaid.render(id, source),
  initialize: (config) => mermaid.initialize({ ...base, ...config }),
};
