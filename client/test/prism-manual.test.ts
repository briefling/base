import { test } from 'node:test';
import assert from 'node:assert/strict';

// Prism reads `window.Prism.manual` when it loads: give node a `window` (own process per test file), then load the
// module the app loads. Proves prism-manual.ts is imported before prismjs.
(globalThis as { window?: unknown }).window = globalThis;
await import('../src/highlight.ts');

test('Prism in manual mode: it never highlights the page by itself (innerHTML)', () => {
  assert.equal((globalThis as { Prism?: { manual?: boolean } }).Prism?.manual, true);
});
