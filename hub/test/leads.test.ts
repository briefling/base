import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadMatch, leadWords, recallLeads, leadId, stepKind, type Lead } from '../../protocol/leads.ts';

// Real lines and conversation starts from prod (docs/project-status.md « Pending leads »): the ones recalled, and the near misses kept out.
test('leadMatch: the prod recalls pass, the near misses stay out', () => {
  assert.ok(leadMatch('Préparer le fichier QGIS de Barbaroux (chantier à ouvrir)', '@Lulu préparer le fichier QGIS de Barbarou'));
  assert.ok(leadMatch('Reporter les réponses de Félix (27 points du CODIR du 06/11), chaque point validé par Paulo', '@Lulu reporte les réponses de Félix'));
  assert.ok(leadMatch("Correctif plateforme pour les deux défauts de l'enregistreur de trajet relevés dans #222", '@Lulu corrige les deux défauts du trajet relevés dans #222'));
  // Two shared words only: out (strict threshold).
  assert.equal(leadMatch('Étape 3 : routine Veille concurrentielle sur le space briefling', 'Veille concurrentielle'), null);
  // Shared vocabulary of every briefling thread is no subject.
  assert.equal(leadMatch('Étape 2 : sortir memoryView de main.ts en module client.', 'Client : sortir les cartes de conversation de main.ts'), null);
  assert.equal(leadMatch('Passer les profils agents en plugin 0.3.32 et redémarrer les gateways', 'Petit test depuis la mise à jour d\'hermes @Milan'), null);
  // Low share of a long line: out.
  assert.equal(leadMatch('Commiter côté hôte le dépôt team-skills : modifs non commitées depuis le 22/10, dont celles du container', 'Montage par session : le projet du chantier fixe ce que ton container voit, opcode'), null);
});

test('leadWords: accents, plurals, numbers, mentions and links folded away', () => {
  assert.deepEqual([...leadWords('Vulnérabilités des routines @milan https://x.y/z 0.3.57')].sort(), ['routin', 'vulner']);
  assert.deepEqual([...leadWords('vulnérabilité routine')].sort(), ['routin', 'vulner']);
});

test('recallLeads: never a recalled lead nor one of this conversation, best first, RECALL_MAX at most', () => {
  const l = (id: string, what: string, extra: Partial<Lead> = {}): Lead => ({ id, space: 's', from: 'o', fromTitle: 'O', agent: 'a', who: 'Agent', what, at: 1, version: 1, ...extra });
  const text = 'préparer le fichier QGIS de Barbaroux, parcours témoin, export GeoJSON';
  const got = recallLeads([
    l('a', 'Préparer le fichier QGIS de Barbaroux'),
    l('b', 'Préparer le fichier QGIS de Barbaroux', { recalled: { thread: 'x', at: 2 } }),
    l('c', 'Préparer le fichier QGIS de Barbaroux', { from: 'self' }),
    l('d', 'Export GeoJSON du parcours témoin de Barbaroux et fichier QGIS'),
    l('e', 'QGIS Barbaroux fichier'),
    l('f', 'Payer Apple et Google'),
  ], text, 'self');
  assert.deepEqual(got.map(x => x.id), ['d', 'a']);
});

test('leadId: stable per line, differs per line and per origin', () => {
  assert.equal(leadId('t1', 'x'), leadId('t1', 'x'));
  assert.notEqual(leadId('t1', 'x'), leadId('t1', 'y'));
  assert.notEqual(leadId('t1', 'x'), leadId('t2', 'x'));
});

test('stepKind: agent, human, or nothing when ambiguous', () => {
  const people = [{ id: 'gaston', name: 'gaston', kind: 'agent' as const }, { id: 'blair', name: 'Blair Dalton', kind: 'human' as const }];
  assert.equal(stepKind('Agent', people), 'agent');
  assert.equal(stepKind('Gaston', people), 'agent');
  assert.equal(stepKind('Blair', people), 'human');
  assert.equal(stepKind('Blair et l\'agent', people), null);
});
