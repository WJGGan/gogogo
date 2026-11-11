import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDataServer } from '../src/server.js';

test('后台搜索立即受理，并可轮询阶段和最终结果', async () => {
  const owner = new Map();
  const stages = new Map();
  const trialStore = {
    session(token) { return token === 'test-token' ? { userId: 'user-1', mode: 'invite' } : null; },
    createRun(id, userId) {
      if (!owner.has(id)) owner.set(id, userId);
      return owner.get(id) === userId;
    },
    ownsRun(id, userId) { return owner.get(id) === userId; },
    saveStage(id, stage, value) { stages.set(`${id}:${stage}`, value); },
    readStage(id, stage) { return stages.get(`${id}:${stage}`) || null; },
  };
  const orchestrator = {
    async run(input, { emit }) {
      emit({ type: 'stage.started', stage: 'keywords' });
      emit({ type: 'progress', phase: 'keywords', percent: 8, message: '正在生成检索词' });
      await new Promise((resolve) => setTimeout(resolve, 200));
      trialStore.saveStage(input.runId, 'keyword-plan', { keywords: ['北京 海淀 咖啡', '北京 海淀 网球'] });
      emit({ type: 'stage.completed', stage: 'keywords' });
      emit({ type: 'stage.started', stage: 'retrieve' });
      await new Promise((resolve) => setTimeout(resolve, 200));
      emit({ type: 'stage.completed', stage: 'retrieve' });
      emit({ type: 'stage.started', stage: 'results' });
      emit({ type: 'stage.completed', stage: 'results' });
      emit({ type: 'progress', phase: 'done', percent: 100, message: '已整理完成' });
      return { run: { id: input.runId }, output: { cards: [] } };
    },
  };
  const server = createDataServer({}, { trialStore, orchestrator });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
    const runId = 'background-test-run';
    const start = await fetch(`${base}/api/discovery/start`, { method: 'POST', headers,
      body: JSON.stringify({ runId, location: '北京海淀', request: '打完网球吃点东西' }) });
    assert.equal(start.status, 202);
    const running = await fetch(`${base}/api/discovery/status?runId=${runId}`, { headers });
    const runningPayload = await running.json();
    assert.equal(runningPayload.data.state, 'running');
    assert.equal(runningPayload.data.progress.message, '正在生成检索词');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const done = await fetch(`${base}/api/discovery/status?runId=${runId}`, { headers });
    const payload = await done.json();
    assert.equal(payload.data.state, 'done');
    assert.deepEqual(payload.data.completedStages, ['keywords', 'retrieve', 'results']);
    assert.equal(payload.data.keywordPlan.keywords.length, 2);
    assert.equal(payload.data.progress.percent, 100);
    assert.equal(payload.data.result.run.id, runId);
  } finally {
    server.close();
  }
});

test('方向细化也可后台轮询，不占用单次长请求', async () => {
  const stages = new Map([
    ['run-1:complete-run', { output: { keywordPlan: { brief: { location: '北京' } },
      cards: [{ id: 'card-1', title: '咖啡店' }] } }],
    ['run-1:evidence-notes', [{ id: 'note-1', title: '参考笔记' }]],
  ]);
  const trialStore = {
    session(token) { return token === 'test-token' ? { userId: 'user-1', mode: 'invite' } : null; },
    ownsRun(id, userId) { return id === 'run-1' && userId === 'user-1'; },
    readStage(id, stage) { return stages.get(`${id}:${stage}`) || null; },
    saveStage(id, stage, value) { stages.set(`${id}:${stage}`, value); },
  };
  const directionPlanner = { async plan() {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { steps: [{ action: '坐下喝咖啡' }], notesRead: 1 };
  } };
  const server = createDataServer({}, { trialStore, directionPlanner });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
    const started = await fetch(`${base}/api/discovery/plan/start`, { method: 'POST', headers,
      body: JSON.stringify({ runId: 'run-1', cardId: 'card-1' }) });
    assert.equal(started.status, 202);
    const statusUrl = `${base}/api/discovery/plan/status?runId=run-1&cardId=card-1`;
    const running = await fetch(statusUrl, { headers }).then((response) => response.json());
    assert.equal(running.data.state, 'running');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const done = await fetch(statusUrl, { headers }).then((response) => response.json());
    assert.equal(done.data.state, 'done');
    assert.equal(done.data.result.notesRead, 1);
  } finally {
    server.close();
  }
});
