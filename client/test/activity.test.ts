import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityOf, steadyActivity } from '../src/activity.ts';

test('activity: Hermes tool verbs map to a category', () => {
  assert.equal(activityOf('is searching the web for API Gateway WebSocket…'), 'docs');
  assert.equal(activityOf('is reading https://docs.aws.amazon.com/x…'), 'docs', 'web_extract says Reading too');
  assert.equal(activityOf('is reading client/src/main.ts…'), 'read');
  assert.equal(activityOf('is editing main.ts…'), 'code');
  assert.equal(activityOf('is writing docs/x.md…'), 'code');
  assert.equal(activityOf('is searching files status…'), 'search');
  assert.equal(activityOf('is looking at the image…'), 'look');
  assert.equal(activityOf('is browsing http://127.0.0.1:8080…'), 'look');
  assert.equal(activityOf('is updating skill…'), 'note');
  assert.equal(activityOf('is reading skill briefling…'), 'docs');
  assert.equal(activityOf('is delegating 2 parallel tasks…'), 'delegate');
  assert.equal(activityOf('Reading the firmware spec'), 'read', 'no « is », capitalised');
});

test('activity: « is running » is classified by its command', () => {
  assert.equal(activityOf('is running grep -n "def _send_frame" -A12 brief…'), 'search');
  assert.equal(activityOf('is running sed -n 20,60p briefling/browserthumb…'), 'search');
  assert.equal(activityOf('is running git log --oneline -5…'), 'search');
  assert.equal(activityOf("is running sed -i 's/ a._ws, a._send_lock, a.na…"), 'code');
  assert.equal(activityOf('is running npx tsc --noEmit -p . && npm test…'), 'test');
  assert.equal(activityOf('is running cd test && python3 ui-render.py --only 44…'), 'test');
  assert.equal(activityOf('is running PYTHONPATH=/root/.cache/hermes-agent /root/.cache/hvenv/bin/python -m pytest -q…'), 'test');
  assert.equal(activityOf('is running BRIEFLING_STACK=briefling-prod npm run deploy > log && git push…'), 'deploy', 'deploy wins over push');
  assert.equal(activityOf('is running git add -A && git commit -m x…'), 'commit');
  assert.equal(activityOf('is running git push origin HEAD:main…'), 'commit');
  assert.equal(activityOf('is running code from hermes_tools import patch…'), 'code');
  assert.equal(activityOf('is running python3 - <<\'E\' p=\'docs/project-stat…'), 'work', 'unknown script');
  assert.equal(activityOf('is running ls…'), 'work');
});

test('activity: tools without a verb, and the fallback', () => {
  assert.equal(activityOf('is using memory_search…'), 'search');
  assert.equal(activityOf('is using thread_read…'), 'search');
  assert.equal(activityOf('is using memory_propose…'), 'note');
  assert.equal(activityOf('is using turn_outcome…'), 'work');
  assert.equal(activityOf('is generating image…'), 'work');
  assert.equal(activityOf('lance npm test…'), 'work', 'not a Hermes phrase');
  assert.equal(activityOf(''), 'work');
  assert.equal(activityOf(undefined), 'work');
  assert.equal(activityOf(null), 'work');
});

test('steady activity: majority of the last 3 phrases, ties to the latest, unknown ones ignored', () => {
  const g = 'is running grep x…', e = 'is editing a.ts…', t = 'is running npm test…', u = 'is using turn_outcome…';
  assert.equal(steadyActivity([g, g, e]), 'search', 'one edit between searches does not flip the verb');
  assert.equal(steadyActivity([e, g, t]), 'test', 'all different: the latest');
  assert.equal(steadyActivity([t, t, t, g, e]), 'code', 'only the last 3 count');
  assert.equal(steadyActivity([g, u, u]), 'search', 'unknown phrases do not hide a known one');
  assert.equal(steadyActivity([u]), 'work');
  assert.equal(steadyActivity([], 'is editing a.ts…'), 'code', 'no feed: the current phrase');
  assert.equal(steadyActivity(undefined, undefined), 'work');
  assert.equal(steadyActivity([g, g], e), 'search', 'current phrase not yet in recent is appended');
  assert.equal(steadyActivity([g, e], e), 'code', 'current already last in recent is not counted twice');
});
