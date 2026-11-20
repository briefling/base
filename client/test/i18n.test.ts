import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTS, LANG_KEY, translate, t, tn, ordinal, quote, lang, setLang, hasKey, isLang, initialLang, type Key } from '../src/i18n.ts';

test('en and fr have exactly the same keys, none empty', () => {
  const en = Object.keys(DICTS.en).sort(), fr = Object.keys(DICTS.fr).sort();
  assert.deepEqual(fr, en);
  for (const l of ['en', 'fr'] as const) for (const [k, v] of Object.entries(DICTS[l])) assert.ok(v.trim(), `${l}.${k} empty`);
});

test('same {placeholders} in both languages', () => {
  const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const k of Object.keys(DICTS.en) as Key[]) assert.deepEqual(ph(DICTS.fr[k]), ph(DICTS.en[k]), k);
});

test('plural keys come in _one/_other pairs', () => {
  for (const k of Object.keys(DICTS.en)) {
    if (k.endsWith('_one')) assert.ok(hasKey(k.replace(/_one$/, '_other')), k);
    if (k.endsWith('_other') && !k.startsWith('nth_')) assert.ok(hasKey(k.replace(/_other$/, '_one')), k);
  }
});

test('default language is English (no window: nothing stored), storage key', () => {
  assert.equal(lang(), 'en');
  assert.equal(t('now'), 'Now');
  assert.equal(t('lounge'), 'Bar');
  assert.equal(LANG_KEY, 'briefling.lang');
});

test('first load: the stored choice, else the first browser language the UI knows, else English', () => {
  assert.equal(initialLang(null, ['fr-CA', 'en']), 'fr');
  assert.equal(initialLang(null, ['de-DE', 'de', 'FR']), 'fr');
  assert.equal(initialLang(null, ['en-US', 'fr-FR']), 'en');
  assert.equal(initialLang(null, ['de', 'es']), 'en');
  assert.equal(initialLang(null, []), 'en');
  assert.equal(initialLang('en', ['fr-FR']), 'en');
  assert.equal(initialLang('fr', ['en-US']), 'fr');
  assert.equal(initialLang('de', ['fr-FR']), 'fr'); // a value no longer valid is ignored
});

test('French = the former UI words (Later / Closed renamed by Blair: one name for button, state and sidebar entry)', () => {
  assert.deepEqual(['now', 'lounge', 'state_you', 'state_done', 'state_idea', 'later', 'nav_later', 'close', 'nav_closed', 'card_thread', 'not_now', 'release_btn', 'reply_topic', 'nav_work'].map(k => translate('fr', k as Key, { agent: 'Milan' })),
    ['Maintenant', 'Comptoir', 'À toi', 'Clôturé', 'Plus tard', 'Plus tard', 'Plus tard', 'Clôturer', 'Clôturé', 'Chantier proposé', 'Pas maintenant', 'Libérer Milan', 'Répondre en sujet', 'Chantiers']);
});

test('interpolation: every occurrence, numbers, unknown params left as is', () => {
  assert.equal(translate('en', 'release_btn', { agent: 'Milan' }), 'Release Milan');
  assert.equal(translate('fr', 'err_max_files', { n: 10 }), '10 pièces jointes maximum par message.');
  assert.equal(translate('fr', 'det_title'), 'Infos du chantier');
  assert.equal(translate('fr', 'lineage_card', { title: 'X' }), 'X (chantier proposé)');
  // FR vocabulary: a thread is a « chantier », never a « fil », and a proposed thread is not a « carte »
  for (const [k, v] of Object.entries(DICTS.fr)) {
    assert.doesNotMatch(v, /\bfils?\b/i, `fr.${k} says fil`);
    assert.doesNotMatch(v, /cartes? (proposée|de chantier|du Café|du Comptoir)|depuis une carte/i, `fr.${k} calls a proposed thread a carte`);
  }
  assert.equal(translate('en', 'release_btn', {}), 'Release {agent}');
  assert.equal(translate('en', 'now', { agent: 'x' }), 'Now');
});

test('fallback: unknown language -> English, unknown key -> the key itself', () => {
  assert.equal(translate('de' as never, 'now'), 'Now');
  assert.equal(translate('fr', 'nope' as Key), 'nope');
  assert.equal(hasKey('err_stale'), true);
  assert.equal(hasKey('err_nope'), false);
  assert.equal(hasKey('toString'), false); // own keys only
  assert.equal(isLang('fr'), true);
  assert.equal(isLang('de'), false);
});

test('plurals and ordinals follow the language rules; switching re-reads the dictionary', () => {
  try {
    assert.equal(tn('spawned', 1), 'Thread');
    assert.equal(tn('spawned', 2), 'Threads');
    assert.deepEqual([1, 2, 3, 4, 11, 21].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '21st']);
    assert.equal(quote('x'), '“x”');
    setLang('fr'); // no window: memory only, no warning from node's localStorage
    assert.equal(lang(), 'fr');
    assert.equal(t('now'), 'Maintenant');
    assert.equal(tn('sp_done', 1), '1 terminé');
    assert.equal(tn('sp_done', 0), '0 terminé'); // French: 0 is singular
    assert.equal(tn('sp_done', 3), '3 terminés');
    assert.equal(tn('spawned', 3), 'Chantiers');
    assert.deepEqual([tn('sp_run', 1), tn('sp_you', 1), tn('sp_wait', 2)], ['1 en cours', '1 à toi', '2 en attente']);
    assert.equal(t('keeps_place'), 'Garde une place');
    assert.equal(t('keeps_place_tip', { agent: 'Testbot' }), 'Testbot garde cette place jusqu\'à ce que le chantier soit fermé ou libéré');
    assert.equal(tn('res_holder_tail', 2), ' · 2 chantiers attendent : ');
    assert.deepEqual([1, 2].map(ordinal), ['1er', '2e']);
    assert.equal(quote('x'), '« x »');
  } finally { setLang('en'); }
});
