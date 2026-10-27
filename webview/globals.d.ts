// Provided by VS Code inside every webview.
interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Stylesheets are bundled by esbuild into dist/webview.css.
declare module '*.css';
