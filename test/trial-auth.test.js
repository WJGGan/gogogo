import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrialStore } from '../src/data/trial-store.js';
import { createDataServer } from '../src/server.js';

test('邀请码会话隔离运行记录和修改接口', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gogogo-trial-'));
  const store = createTrialStore(join(dir, 'trial.sqlite'));
  const alice = store.redeem('alice-code', ['alice-code', 'bob-code']);
  const bob = store.redeem('bob-code', ['alice-code', 'bob-code']);
  store.createRun('alice-run', alice.userId);
  store.saveStage('alice-run', 'complete-run', { output: { cards: [{ id: 'card-1' }] } });
  store.saveStage('alice-run', 'evidence-notes', []);
  let revised = false;
  const server = createDataServer({}, { trialStore: store, inviteCodes: ['alice-code', 'bob-code'],
    keywordAgent: {}, discovery: {}, orchestrator: {}, directionPlanner: { async plan() { return { steps: [] }; } },
    revision: { async revise() { revised = true; return {}; } } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, token, body) => fetch(`${base}${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  try {
    const ownConfig = { apiKey: 'own-test-key-123', apiUrl: 'https://api.deepseek.com/chat/completions', model: 'test-model' };
    const ownLogin = await fetch(`${base}/api/auth/own`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ownConfig) });
    assert.equal(ownLogin.status, 200);
    const ownToken = (await ownLogin.json()).data.token;
    const ownStatus = await fetch(`${base}/api/auth/status`, { headers: { Authorization: `Bearer ${ownToken}`,
      'X-Model-Api-Key': ownConfig.apiKey, 'X-Model-Api-Url': ownConfig.apiUrl, 'X-Model-Name': ownConfig.model } });
    assert.equal((await ownStatus.json()).data.mode, 'own');
    assert.equal((await fetch(`${base}/api/auth/status`, { headers: { Authorization: `Bearer ${ownToken}` } })).status, 400);
    assert.equal((await post('/api/discovery/plan', bob.token, { runId: 'alice-run', cardId: 'card-1' })).status, 404);
    assert.equal((await post('/api/discovery/revise', bob.token, { runId: 'alice-run' })).status, 404);
    assert.equal(revised, false);
    assert.equal((await post('/api/discovery/plan', alice.token, { runId: 'alice-run', cardId: 'card-1' })).status, 200);
    assert.equal((await post('/api/discovery/plan', '', { runId: 'alice-run', cardId: 'card-1' })).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
