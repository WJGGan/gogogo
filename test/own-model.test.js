import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateOwnModel } from '../src/config/own-model.js';
import { createTrialStore } from '../src/data/trial-store.js';
import { createDataServer } from '../src/server.js';
import { createJsonModel } from '../src/agents/model-json.js';

test('自带模型配置接受允许的 HTTPS 接口和模型', () => {
  assert.deepEqual(validateOwnModel({ apiKey: 'test-key-123', apiUrl: 'https://api.deepseek.com/chat/completions', model: 'my-model' }),
    { apiKey: 'test-key-123', apiUrl: 'https://api.deepseek.com/chat/completions', model: 'my-model', provider: 'deepseek' });
});

test('自带模型配置拒绝非允许域名与内部地址', () => {
  for (const apiUrl of ['http://api.deepseek.com/chat/completions', 'https://127.0.0.1/chat/completions',
    'https://example.test/chat/completions', 'https://api.deepseek.com:8443/chat/completions',
    'https://api.deepseek.com/other']) {
    assert.throws(() => validateOwnModel({ apiKey: 'test-key-123', apiUrl, model: 'my-model' }));
  }
});

test('新填的 URL、模型和 Key 经 HTTP 请求传入实际模型调用', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gogogo-own-model-'));
  const store = createTrialStore(join(directory, 'trial.sqlite'));
  const calls = [];
  const model = createJsonModel({ apiKey: 'server-key', apiUrl: 'https://server.example/chat/completions', model: 'server-model',
    fetchImpl: async (url, options) => {
      calls.push({ url, key: options.headers.Authorization, model: JSON.parse(options.body).model });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    } });
  const server = createDataServer({}, { trialStore: store, inviteCodes: ['invite-test'],
    keywordAgent: { generate: async () => model.complete('test', {}) }, discovery: {}, orchestrator: {}, revision: {}, directionPlanner: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const config = { apiUrl: 'https://api.deepseek.com/chat/completions', model: 'new-model', apiKey: 'new-key-123456' };
    const login = await fetch(`${base}/api/auth/own`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    assert.equal(login.status, 200);
    const token = (await login.json()).data.token;
    const response = await fetch(`${base}/api/discovery/keywords`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
        'X-Model-Api-Url': config.apiUrl, 'X-Model-Name': config.model, 'X-Model-Api-Key': config.apiKey },
      body: JSON.stringify({ runId: randomUUID(), location: '上海', request: '散步' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.ok, true);
    assert.deepEqual(calls, [{ url: config.apiUrl, key: `Bearer ${config.apiKey}`, model: config.model }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
