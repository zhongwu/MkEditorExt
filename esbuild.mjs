// Builds the extension host bundle and the webview bundle.
//   node esbuild.mjs               development build
//   node esbuild.mjs --watch       rebuild on change
//   node esbuild.mjs --production  minified, no source maps
//   node esbuild.mjs --tests       also build integration tests into out/
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');
const tests = process.argv.includes('--tests');

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

const builds = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: ['webview/main.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
  },
];

// Loaded on demand by the webview (webview/livePreview/lazy.ts). The KaTeX stylesheet and fonts
// are written next to katex.js; only the woff2 fonts are needed.
builds.push({
  ...common,
  entryPoints: { katex: 'webview/lazy/katex.ts', mermaid: 'webview/lazy/mermaid.ts' },
  outdir: 'dist',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  loader: { '.woff2': 'file', '.woff': 'empty', '.ttf': 'empty' },
  assetNames: 'fonts/[name]',
});

if (tests) {
  builds.push({
    ...common,
    entryPoints: ['test/integration/*.test.ts'],
    outdir: 'out/integration',
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    external: ['vscode'],
  });
}

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
