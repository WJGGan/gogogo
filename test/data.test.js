import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createXiaohongshuData, DataError } from '../src/data/xiaohongshu.js';
import { createDataServer } from '../src/server.js';

const calls = [];
const fetchImpl = async (url, init) => {
  calls.push({ path: url.pathname, method: init.method, body: init.body && JSON.parse(init.body) });
  let data;
  if (url.pathname.endsWith('/login/status')) {
    data = { is_logged_in: true, username: 'tester', user_id: 'u1' };
  } else if (url.pathname.endsWith('/login/qrcode')) {
    data = { is_logged_in: false, timeout: '4m0s', img: 'data:image/png;base64,abc' };
  } else if (url.pathname.endsWith('/feeds/search')) {
    data = { feeds: [
      { id: 'n1', xsecToken: 'token+/=', modelType: 'note', noteCard: { displayTitle: '上海散步', type: 'normal', user: { userId: 'u1', nickname: '作者' }, cover: { urlDefault: 'https://image.test/1' }, interactInfo: { likedCount: '10' } } },
      { id: 'n1', xsecToken: 'token+/=', modelType: 'note', noteCard: {} },
      { id: 'other', modelType: 'hot_query' },
    ] };
  } else {
    data = { feed_id: 'n1', data: { note: { noteId: 'n1', xsecToken: 'token+/=', title: '上海散步', desc: '散步路线', user: { nickname: '作者' }, imageList: [{ urlDefault: 'https://image.test/1' }] }, comments: { hasMore: true, list: [{ id: 'c1', content: '很不错', subComments: [] }] } } };
  }
  return new Response(JSON.stringify({ success: true, data }), { status: 200 });
};

const provider = createXiaohongshuData({ fetchImpl });

test('登录状态和二维码正确映射', async () => {
  assert.deepEqual(await provider.loginStatus(), { isLoggedIn: true, username: 'tester', userId: 'u1' });
  assert.equal((await provider.loginQrCode()).image, 'data:image/png;base64,abc');
});

test('搜索结果去重、过滤非笔记并保留详情 token 和来源链接', async () => {
  const result = await provider.searchNotes('上海散步');
  assert.equal(result.count, 1);
  assert.equal(result.notes[0].title, '上海散步');
  assert.equal(result.notes[0].xsecToken, 'token+/=');
  assert.equal(new URL(result.notes[0].url).searchParams.get('xsec_token'), 'token+/=');
  assert.deepEqual(calls.at(-1).body, { keyword: '上海散步' });
});

test('详情包含正文、评论和图片', async () => {
  const result = await provider.getNoteDetail('n1', 'token+/=');
  assert.equal(result.description, '散步路线');
  assert.equal(result.comments[0].content, '很不错');
  assert.equal(result.commentsHasMore, true);
  assert.deepEqual(result.images, ['https://image.test/1']);
  assert.equal(calls.at(-1).body.xsec_token, 'token+/=');
});

test('输入与上游错误返回明确错误码', async () => {
  await assert.rejects(provider.searchNotes(''), { code: 'INVALID_INPUT' });
  const failed = createXiaohongshuData({ fetchImpl: async () => new Response(JSON.stringify({ error: '服务器内部错误' }), { status: 500 }) });
  await assert.rejects(failed.searchNotes('上海'), { code: 'UPSTREAM_ERROR' });
  assert.ok(new DataError('TEST', 'test') instanceof Error);
});

const server = createDataServer(provider);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
after(() => server.close());
const base = `http://127.0.0.1:${server.address().port}`;

test('HTTP 搜索接口返回可用结构并校验参数', async () => {
  const ok = await fetch(`${base}/api/data/notes/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword: '上海散步' }) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.notes[0].id, 'n1');
  const bad = await fetch(`${base}/api/data/notes/detail`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'INVALID_INPUT');
});
