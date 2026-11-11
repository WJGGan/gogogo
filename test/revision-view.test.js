import test from 'node:test';
import assert from 'node:assert/strict';
import { revisionContext, resultSummary, revisionFeedback } from '../web/revision-view.js';

test('共享入口根据当前节点切换修改目标和版本', () => {
  assert.match(revisionContext('cards', 0).button, /三个方向/);
  assert.match(revisionContext('detail', 2).button, /这个方案/);
  assert.equal(revisionContext('detail', 2).version, '已修改 2 次');
});

test('缓存补搜未命中时页面不显示全部检索成功', () => {
  const search = { count: 40, quality: { status: 'partial', failedQueries: 1 } };
  const quality = { status: 'partial', message: '本地没有这个补充关键词的缓存；缓存试跑没有访问小红书' };
  const summary = resultSummary(search, [{ id: 'a' }], quality, true);
  assert.match(summary, /1 个检索词未取得结果/);
  assert.match(summary, /没有访问小红书/);
  assert.doesNotMatch(summary, /全部关键词搜索完成/);
  const feedback = revisionFeedback({ kind: 'cards', output: { quality, searchResult: search } });
  assert.match(feedback.title, /证据仍有限/);
  assert.match(feedback.message, /本地没有.*缓存/);
});

test('仅规划补证词时明确显示待接入，不声称已经搜索', () => {
  const quality = { status: 'partial', message: '已规划补证检索词「静安 展览」，待评测数据接入后执行' };
  const feedback = revisionFeedback({ kind: 'cards', supplementalDeferred: true,
    searchAttempted: false, output: { quality, searchResult: { count: 12 } } });
  assert.match(feedback.message, /待评测数据接入后执行/);
  assert.doesNotMatch(feedback.message, /已补充检索/);
});
