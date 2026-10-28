// Loads KaTeX and Mermaid only when a document uses them (PLAN.md §2). Each is a separate bundle
// (dist/katex.js, dist/mermaid.js) added to the page as a <script> with the page's CSP nonce.

export interface KatexApi {
  render(tex: string, element: HTMLElement, options?: Record<string, unknown>): void;
}

export interface MermaidApi {
  render(id: string, source: string): Promise<{ svg: string }>;
  initialize(config: Record<string, unknown>): void;
}

declare global {
  interface Window {
    mdKatex?: KatexApi;
    mdMermaid?: MermaidApi;
  }
}

let assetBase = '';
let scriptNonce = '';

/** `base` is the folder the extension's bundles are served from, ending in "/". */
export function configureAssets(options: { base: string; nonce: string }): void {
  assetBase = options.base;
  scriptNonce = options.nonce;
}

const pending = new Map<string, Promise<void>>();

/** Runs `load` once per key; a failed load is forgotten so a later call can try again. */
function once(key: string, load: () => Promise<void>): Promise<void> {
  let promise = pending.get(key);
  if (!promise) {
    promise = load().catch((error: unknown) => {
      pending.delete(key);
      throw error;
    });
    pending.set(key, promise);
  }
  return promise;
}

function loadScript(file: string): Promise<void> {
  return once(file, () => {
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.nonce = scriptNonce;
      script.src = assetBase + file;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load ${file}`));
      document.head.append(script);
    });
  });
}

function loadStyle(file: string): Promise<void> {
  return once(file, () => {
    return new Promise<void>((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = assetBase + file;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`Could not load ${file}`));
      document.head.append(link);
    });
  });
}

export async function loadKatex(): Promise<KatexApi> {
  await Promise.all([loadScript('katex.js'), loadStyle('katex.css')]);
  if (!window.mdKatex) throw new Error('KaTeX did not start');
  return window.mdKatex;
}

export async function loadMermaid(): Promise<MermaidApi> {
  await loadScript('mermaid.js');
  if (!window.mdMermaid) throw new Error('Mermaid did not start');
  return window.mdMermaid;
}
