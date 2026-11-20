// Must be imported BEFORE prismjs: Prism reads `window.Prism.manual` when it loads. Without it, Prism
// highlights by itself at DOMContentLoaded every `code.language-*` of the page through innerHTML.
// We only call Prism.tokenize() and build the DOM ourselves (client/src/highlight.ts).
(globalThis as { Prism?: unknown }).Prism = { manual: true, disableWorkerMessageHandler: true };
