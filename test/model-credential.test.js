import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJsonModel } from '../src/agents/model-json.js';
import { withModelCredential } from '../src/agents/model-credential.js';

test('自带密钥仅覆盖当前请求，随后恢复服务端密钥', async () => {
  const calls = [];
  const model = createJsonModel({ apiKey: 'server-key', apiUrl: 'https://server.example/api', model: 'test-model',
    fetchImpl: async (url, options) => {
      calls.push({ url, auth: options.headers.Authorization, model: JSON.parse(options.body).model });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
    } });
  await withModelCredential({ apiKey: 'own-key', apiUrl: 'https://api.deepseek.com/chat/completions', model: 'own-model' },
    () => model.complete('system', {}));
  await model.complete('system', {});
  assert.deepEqual(calls, [
    { url: 'https://api.deepseek.com/chat/completions', auth: 'Bearer own-key', model: 'own-model' },
    { url: 'https://server.example/api', auth: 'Bearer server-key', model: 'test-model' },
  ]);
});
