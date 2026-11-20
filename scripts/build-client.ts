// `npm run build:client`: bundles the app and the service worker into client/dist, copies the static files and writes
// version.json. Also the preview origin's files into client/dist-preview (sw.js, __viewer/index.html, __viewer/viewer.js;
// sources client/preview/, deployed to the preview distribution, which adds its own config.json). Build id = hash of what the page runs (app.js, style.css, index.html): a deploy that leaves the front
// unchanged keeps the id, so open tabs are only told to reload when there is something new (client/src/version.ts).
import { buildSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const client = fileURLToPath(new URL('../client/', import.meta.url)), dist = `${client}dist/`, distPreview = `${client}dist-preview/`;
const PLACEHOLDER = '__briefling_build_id__'; // never a valid id (client/test/version.test.ts): an unreplaced one stays silent
const common = { bundle: true, target: 'es2022', minify: true, logLevel: 'warning' } as const;

rmSync(dist, { recursive: true, force: true, maxRetries: 5 }); // retries: ENOTEMPTY seen on bind-mounted folders
// Voice channel microphone worklet (client/preview/voice.ts loads it with audioWorklet.addModule: a same-origin file, the
// CSP refuses a blob URL). Not in the service worker's shell; its URL carries its hash so a deploy is a new URL.
buildSync({ ...common, entryPoints: [`${client}preview/voice-worklet.ts`], format: 'iife', outfile: `${dist}voice-worklet.js` });
const workletUrl = `/voice-worklet.js?v=${createHash('sha256').update(readFileSync(`${dist}voice-worklet.js`)).digest('hex').slice(0, 12)}`;
buildSync({ ...common, entryPoints: [`${client}src/main.ts`], format: 'esm', outfile: `${dist}app.js`,
  define: { __BUILD__: JSON.stringify(PLACEHOLDER), __VOICE_WORKLET__: JSON.stringify(workletUrl) } });
buildSync({ ...common, entryPoints: [`${client}src/sw.ts`], format: 'iife', outfile: `${dist}sw.js` });
// File by file, not cpSync: its native directory copy fails with EACCES on bind-mounted folders (agent containers).
mkdirSync(`${dist}icons`);
for (const f of ['index.html', 'style.css', 'favicon.svg', 'manifest.webmanifest', ...readdirSync(`${client}icons`).map(n => `icons/${n}`)]) copyFileSync(`${client}${f}`, `${dist}${f}`);

const app = readFileSync(`${dist}app.js`, 'utf8');
if (!app.includes(PLACEHOLDER)) throw new Error('build id placeholder missing from app.js (__BUILD__ no longer used?)');
const hash = createHash('sha256');
for (const part of [app, readFileSync(`${dist}style.css`), readFileSync(`${dist}index.html`)]) hash.update(part);
const build = hash.digest('hex').slice(0, 12);
writeFileSync(`${dist}app.js`, app.replaceAll(PLACEHOLDER, build));
writeFileSync(`${dist}version.json`, JSON.stringify({ build }));
// Preview origin: never shares a file with the app (its own origin, its own service worker).
rmSync(distPreview, { recursive: true, force: true, maxRetries: 5 });
buildSync({ ...common, entryPoints: [`${client}preview/sw.ts`], format: 'iife', outfile: `${distPreview}sw.js` });
buildSync({ ...common, entryPoints: [`${client}preview/viewer.ts`], format: 'iife', outfile: `${distPreview}__viewer/viewer.js` });
buildSync({ ...common, entryPoints: [`${client}preview/visit.ts`], format: 'iife', outfile: `${distPreview}__viewer/visit.js` });
// viewer.js is served without Cache-Control (index.html and sw.js are no-cache): Safari kept an old one by heuristic
// caching, deploys did not reach the iPhone. Its URL carries the hash of its content, so a new build is a new URL.
const viewerTag = 'src="/__viewer/viewer.js"', viewerHtml = readFileSync(`${client}preview/index.html`, 'utf8');
if (!viewerHtml.includes(viewerTag)) throw new Error(`${viewerTag} missing from client/preview/index.html`);
const viewerId = createHash('sha256').update(readFileSync(`${distPreview}__viewer/viewer.js`)).digest('hex').slice(0, 12);
copyFileSync(`${client}preview/viewer.css`, `${distPreview}__viewer/viewer.css`);
const cssTag = 'href="/__viewer/viewer.css"';
if (!viewerHtml.includes(cssTag)) throw new Error(`${cssTag} missing from client/preview/index.html`);
const cssId = createHash('sha256').update(readFileSync(`${client}preview/viewer.css`)).digest('hex').slice(0, 12);
writeFileSync(`${distPreview}__viewer/index.html`, viewerHtml.replace(viewerTag, `src="/__viewer/viewer.js?v=${viewerId}"`)
  .replace(cssTag, `href="/__viewer/viewer.css?v=${cssId}"`));
// Visitor page (protocol/preview.ts « Visitor link »): same cache-busting.
const visitTag = 'src="/__viewer/visit.js"', visitHtml = readFileSync(`${client}preview/visit.html`, 'utf8');
if (!visitHtml.includes(visitTag) || !visitHtml.includes(cssTag)) throw new Error(`${visitTag} or ${cssTag} missing from client/preview/visit.html`);
const visitId = createHash('sha256').update(readFileSync(`${distPreview}__viewer/visit.js`)).digest('hex').slice(0, 12);
writeFileSync(`${distPreview}__viewer/visit.html`, visitHtml.replace(visitTag, `src="/__viewer/visit.js?v=${visitId}"`)
  .replace(cssTag, `href="/__viewer/viewer.css?v=${cssId}"`));
console.log(`client build ${build}`);
