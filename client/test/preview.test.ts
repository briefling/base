import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheName, fromParent, fromViewer, fromViewerMsg, immutable, keyOfHash, previewKey, swBypass, toViewer } from '../preview/bridge.ts';
import { previewBase, previewReason, previewReshareText, previewStateText, previewStep, voiceAction, voiceAgent, voiceLineOf, voiceResumeStep, VOICE_RESUME_MS, type PreviewState } from '../src/preview.ts';
import { DICTS, type Key, type Lang, type Params } from '../src/i18n.ts';
import { PREVIEW_ERRORS } from '../../protocol/preview.ts';

const tr = (l: Lang) => (k: Key, p: Params = {}) => DICTS[l][k].replace(/\{(\w+)\}/g, (_, n: string) => String(p[n]));
const en = tr('en'), fr = tr('fr');

test('postMessage gate, viewer side: only its parent window, only at an allowed app origin', () => {
  const parent = {}, self = {}, other = {}, parents = ['https://chat.example.org', 'https://d3x.cloudfront.net'];
  const ev = (origin: string, source: unknown) => ({ origin, source, data: null });
  assert.equal(fromParent(ev('https://chat.example.org', parent), parents, parent, self), true);
  assert.equal(fromParent(ev('https://d3x.cloudfront.net', parent), parents, parent, self), true);
  assert.equal(fromParent(ev('https://evil.test', parent), parents, parent, self), false, 'origin not listed');
  assert.equal(fromParent(ev('https://chat.example.org', other), parents, parent, self), false, 'another window (the previewed page, a popup)');
  assert.equal(fromParent(ev('https://chat.example.org', self), parents, self, self), false, 'not framed: parent === self');
  assert.equal(fromParent(ev('https://chat.example.org', parent), [], parent, self), false, 'no config');
  assert.equal(fromParent(ev('null', null), ['null'], null, self), false);
});

test('postMessage gate, app side: only the overlay iframe, only at the preview origin', () => {
  const frame = {}, other = {}, o = 'https://preview.briefling.test';
  assert.equal(fromViewer({ origin: o, source: frame, data: null }, o, frame), true);
  assert.equal(fromViewer({ origin: 'https://evil.test', source: frame, data: null }, o, frame), false);
  assert.equal(fromViewer({ origin: o, source: other, data: null }, o, frame), false, 'the inner previewed page or another tab');
  assert.equal(fromViewer({ origin: o, source: null, data: null }, o, null), false, 'iframe gone');
  assert.equal(fromViewer({ origin: o, source: frame, data: null }, null, frame), false, 'feature off');
});

test('postMessage shapes: well-formed only, tagged bp: 1', () => {
  assert.deepEqual(toViewer({ bp: 1, type: 'ready', ice: [{ urls: ['turn:x'], username: 'u', credential: 'c' }] }), { bp: 1, type: 'ready', ice: [{ urls: ['turn:x'], username: 'u', credential: 'c' }] });
  assert.deepEqual(toViewer({ bp: 1, type: 'candidate', candidate: '', mid: null }), { bp: 1, type: 'candidate', candidate: '', mid: null });
  assert.equal(toViewer({ type: 'answer', sdp: 'v=0' }), null, 'untagged');
  assert.equal(toViewer({ bp: 1, type: 'ready', ice: [{ urls: 'turn:x' }] }), null, 'urls must be an array');
  assert.equal(toViewer({ bp: 1, type: 'token', value: 'x' }), null);
  assert.deepEqual(fromViewerMsg({ bp: 1, type: 'offer', sdp: 'v=0' }), { bp: 1, type: 'offer', sdp: 'v=0' });
  assert.deepEqual(fromViewerMsg({ bp: 1, type: 'failed', code: 'channel' }), { bp: 1, type: 'failed', code: 'channel' });
  assert.equal(fromViewerMsg({ bp: 1, type: 'failed', code: 'whatever' }), null);
  assert.equal(fromViewerMsg({ bp: 1, type: 'offer', sdp: 3 }), null);
  assert.equal(fromViewerMsg('hello'), null);
});

test('service worker: cache only `immutable` responses; never intercept the viewer, itself or config.json', () => {
  assert.equal(immutable('public, max-age=31536000, immutable'), true);
  assert.equal(immutable('Immutable'), true);
  for (const cc of [null, undefined, '', 'max-age=31536000', 'no-cache', 'public, immutablex', 'no-store']) assert.equal(immutable(cc), false, String(cc));
  for (const p of ['/__viewer/index.html', '/__viewer/viewer.js', '/sw.js', '/config.json']) assert.equal(swBypass(p), true, p);
  for (const p of ['/', '/src/main.tsx', '/sw.js.map', '/config.json5', '/__viewerx']) assert.equal(swBypass(p), false, p);
});

test('preview key: agent + port, one cache per key, carried in the viewer hash', () => {
  assert.equal(previewKey('Testbot', 5173), 'testbot-5173');
  assert.equal(previewKey('a b/../c', 80), 'a_b____c-80');
  assert.equal(cacheName('testbot-5173'), 'preview-testbot-5173');
  assert.equal(keyOfHash('#key=testbot-5173'), 'testbot-5173');
  assert.equal(keyOfHash('#x=1&key=g-3000'), 'g-3000');
  assert.equal(keyOfHash('#key=../x'), null);
  assert.equal(keyOfHash(''), null);
});

test('previewUrl of the app config: no trailing slash, http(s) only, else off', () => {
  assert.equal(previewBase('https://d1.cloudfront.net/'), 'https://d1.cloudfront.net');
  assert.equal(previewBase('https://preview.briefling.test'), 'https://preview.briefling.test');
  for (const x of [undefined, '', 'nope', 'javascript:alert(1)', 42]) assert.equal(previewBase(x), null, String(x));
});

test('overlay state text: connecting / connected in X.X s / shown / failed: reason / closed, EN and FR', () => {
  const S = (s: PreviewState, l: Lang = 'en') => previewStateText(s, l === 'en' ? en : fr, l);
  assert.equal(S({ k: 'connecting' }), 'Connecting…');
  assert.equal(S({ k: 'connected', open: 812 }), 'Connected in 0.8 s');
  assert.equal(S({ k: 'connected', open: 812 }, 'fr'), 'Connecté en 0,8 s');
  assert.equal(S({ k: 'shown', open: 900, shown: 1460 }), 'Shown in 1.5 s (connected in 0.9 s)');
  assert.equal(S({ k: 'failed', code: 'port_closed' }), 'Failed: nothing listens on that port');
  assert.equal(S({ k: 'failed', code: 'channel' }, 'fr'), "Échec : la connexion ne s'est pas ouverte");
  assert.equal(S({ k: 'failed', code: 'weird' }), 'Failed: refused (weird)');
  assert.equal(S({ k: 'closed' }), 'Closed');
  for (const c of [...PREVIEW_ERRORS, 'forbidden', 'channel', 'sw', 'config']) for (const t of [en, fr]) assert.doesNotMatch(previewReason(c, t), /undefined|\{/, c);
});

test('overlay state steps: open then loaded (times kept), failure and close are final', () => {
  let s: PreviewState = { k: 'connecting' };
  s = previewStep(s, 'loaded', 100); assert.equal(s.k, 'connecting', 'loaded before open: ignored');
  s = previewStep(s, 'open', 700); assert.deepEqual(s, { k: 'connected', open: 700 });
  s = previewStep(s, 'loaded', 1300); assert.deepEqual(s, { k: 'shown', open: 700, shown: 1300 });
  assert.deepEqual(previewStep(s, 'loaded', 5000), s, 'an inner reload keeps the first time');
  const f = previewStep(s, { failed: 'channel' }, 9000); assert.deepEqual(f, { k: 'failed', code: 'channel' });
  assert.deepEqual(previewStep(f, 'open', 9500), f);
  assert.deepEqual(previewStep(previewStep(s, 'closed', 1), 'open', 2), { k: 'closed' });
});

test('reshare request: an @mention of the agent naming the stopped share (port or device), both languages', () => {
  const web = { agent: 'milan', port: 8765, label: 'Prez v5', status: 'off' as const };
  const screen = { agent: 'milan', device: 'emulator-5554', label: 'Manta', status: 'off' as const };
  assert.equal(previewReshareText(web, fr), "@milan repartage l'aperçu Prez v5 (port 8765)");
  assert.equal(previewReshareText(screen, fr), "@milan repartage l'écran Manta (appareil emulator-5554)");
  assert.equal(previewReshareText(web, en), '@milan please share the preview Prez v5 again (port 8765)');
  assert.equal(previewReshareText(screen, en), '@milan please share the screen Manta again (device emulator-5554)');
});

test('voice channel: the no_voice reason, both languages (no reshare request: « Voice » in the composer asks again)', () => {
  assert.equal(previewReason('no_voice', en), 'the voice daemon is not running on the agent side');
  assert.equal(previewReason('no_voice', fr), 'le démon voix ne tourne pas côté agent');
  assert.equal(previewStateText({ k: 'failed', code: 'no_voice' }, en, 'en'), 'Failed: the voice daemon is not running on the agent side');
});

test('voiceAction: a lead opens the voice line on, else asks an agent that talks, else no button', () => {
  const on = { id: 'a', preview: { agent: 'milan', voice: true as const, label: 'voice', status: 'on' as const } };
  const off = { id: 'b', preview: { agent: 'milan', voice: true as const, label: 'voice', status: 'off' as const } };
  assert.equal((voiceAction([on], true, false) as { line: typeof on }).line.id, 'a', 'a line on: opened, whatever the presence');
  assert.equal(voiceAction([on, off], true, true), 'ask', 'stopped: the agent is asked again');
  assert.equal(voiceAction([], true, true), 'ask');
  assert.equal(voiceAction([], true, false), null, 'the agent does not talk (or its gateway is down)');
  assert.equal(voiceAction([on], false, true), null, 'members who are not leads: no button');
});

test('voiceAgent: in a topic the last agent that spoke, else its owner; in a thread the agent in charge', () => {
  const m = (kind: string, id: string) => ({ author: { kind, id } });
  const talk = [m('human', 'blair'), m('agent', 'gideon'), m('human', 'blair'), m('system', 'hub')];
  assert.equal(voiceAgent(talk, 'milan', true), 'gideon', 'the agent Blair talks with, not the space default agent');
  assert.equal(voiceAgent([m('agent', 'gideon'), m('agent', 'milan')], 'gaston', true), 'milan', 'the latest one');
  assert.equal(voiceAgent([m('human', 'blair')], 'milan', true), 'milan', 'no agent spoke yet: the owner');
  assert.equal(voiceAgent(talk, 'milan', false), 'milan', 'a thread: its agent in charge, whoever spoke');
});

test('voiceLineOf: the latest voice line on of the conversation, else null', () => {
  const v = (id: string, status: 'on' | 'off', extra = {}) => ({ id, preview: { agent: 'gideon', voice: true as const, label: 'voice', status }, ...extra });
  const web = { id: 'w', preview: { agent: 'gideon', port: 5173, label: 'app', status: 'on' as const } };
  assert.equal(voiceLineOf([]), null);
  assert.equal(voiceLineOf<{ id: string; preview?: typeof web.preview }>([web, { id: 'x' }]), null, 'a web preview is not a voice channel');
  assert.equal(voiceLineOf([v('a', 'on'), web])?.id, 'a');
  assert.equal(voiceLineOf([v('a', 'on'), v('b', 'off')]), null, 'the voice was stopped after: no button');
  assert.equal(voiceLineOf([v('a', 'off'), v('b', 'on')])?.id, 'b', 'shared again');
  assert.equal(voiceLineOf([v('a', 'on', { deleted: { at: 1 } })]), null);
});

test('voiceResumeStep: one resume per cut, one agent turn at most, then offline after the deadline', () => {
  const now = 1000, until = now + VOICE_RESUME_MS;
  // A cut: the same line again first (a network blip, the peer may still run); a dead share: ask at once.
  assert.deepEqual(voiceResumeStep('lost', null, now), { stage: 'reopen', until });
  assert.deepEqual(voiceResumeStep('timeout', null, now), { stage: 'reopen', until });
  assert.deepEqual(voiceResumeStep('not_connected', null, now), { stage: 'reopen', until });
  assert.deepEqual(voiceResumeStep('gone', null, now), { stage: 'ask', until }, 'the gateway restarted: its share is lost');
  assert.deepEqual(voiceResumeStep('not_shared', null, now), { stage: 'ask', until });
  // Not a cut: shown as it is.
  for (const c of ['mic', 'mic_dead', 'channel', 'forbidden', 'not_trusted', 'ask_timeout', 'preview_off', 'offline'])
    assert.equal(voiceResumeStep(c, null, now), null, c);
  // Reopening: the agent not back yet = same stage, its share dead = ask, same deadline.
  const reopen = { stage: 'reopen' as const, until };
  assert.equal(voiceResumeStep('not_connected', reopen, now + 5000), reopen);
  assert.equal(voiceResumeStep('timeout', reopen, now + 5000), reopen);
  assert.deepEqual(voiceResumeStep('gone', reopen, now + 5000), { stage: 'ask', until });
  assert.equal(voiceResumeStep('channel', reopen, now + 5000), null);
  // Asked: only a refused ask (no turn spent) is tried again; a timeout or a dead share again gives up.
  const ask = { stage: 'ask' as const, until };
  assert.equal(voiceResumeStep('no_voice', ask, now + 5000), ask);
  assert.equal(voiceResumeStep('not_connected', ask, now + 5000), ask);
  for (const c of ['timeout', 'gone', 'not_shared', 'lost', 'ask_timeout']) assert.equal(voiceResumeStep(c, ask, now + 5000), null, c);
  // Past the deadline, the agent never came back: its Mac or its gateway is offline.
  assert.equal(voiceResumeStep('not_connected', reopen, until + 1), 'offline');
  assert.equal(voiceResumeStep('no_voice', ask, until + 1), 'offline');
});
