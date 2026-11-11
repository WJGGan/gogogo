import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { captureStage, readCaptureStage } from '../src/data/run-captures.js';
import { createRevisionService } from '../src/agents/revision.js';
import { createDataServer } from '../src/server.js';

const root = join(process.cwd(), 'data', 'captures', 'runs');
const oldNote = { id: 'old', title: '静安散步', description: '静安街区适合慢慢走。',
  comments: [], url: 'https://example.test/old', matchedKeywords: ['上海 静安 散步'] };
const oldCard = { id: 'old-card', title: '静安街区', decisionAnchor: '静安', decisionType: 'place',
  action: '在静安散步', sources: [{ id: 'old', title: oldNote.title, url: oldNote.url }] };

async function fixture() {
  const runId = randomUUID();
  const keywordPlan = { brief: { location: '上海 静安', request: '散步' }, keywords: ['上海 静安 散步'], facets: ['walk'] };
  await captureStage(runId, 'complete-run', { run: { id: runId }, output: {
    keywordPlan, searchResult: { keywords: keywordPlan.keywords, searches: [], notes: [oldNote], count: 1 },
    cards: [oldCard], research: {}, curation: {},
  } });
  await captureStage(runId, 'evidence-notes', [oldNote]);
  return runId;
}

test('详细页修改只重规划已选卡片，不触发搜索', async () => {
  const runId = await fixture();
  let revisionId;
  let searchCalls = 0;
  try {
    const revision = createRevisionService({
      keywordAgent: { generate: async ({ location, request }) => ({ brief: { location, request }, facets: ['walk'] }) },
      discovery: { search: async () => { searchCalls += 1; throw new Error('不应搜索'); } },
      orchestrator: {},
      directionPlanner: { plan: async () => ({ steps: [{ place: '静安', action: '慢慢走', sourceId: 'old', excerpt: '静安街区适合慢慢走' }],
        unmetRequirements: [], notesRead: 1 }) },
    });
    const result = await revision.revise({ runId, stage: 'detail', cardId: 'old-card',
      location: '上海 静安', request: '安静散步' });
    revisionId = result.run.id;
    assert.equal(result.kind, 'detail');
    assert.equal(result.searchAttempted, false);
    assert.equal(searchCalls, 0);
    assert.equal((await readCaptureStage(revisionId, 'direction-plan-1')).steps.length, 1);
  } finally {
    await rm(join(root, runId), { recursive: true, force: true });
    if (revisionId) await rm(join(root, revisionId), { recursive: true, force: true });
  }
});

test('卡片页证据不足时补搜一次，合并笔记池并重新分析', async () => {
  const runId = await fixture();
  let revisionId;
  let searchCalls = 0;
  let analyses = 0;
  try {
    const revision = createRevisionService({
      supplementalSearchEnabled: true,
      keywordAgent: { generate: async ({ location, request }) => ({ brief: { location, request }, facets: ['walk'] }) },
      discovery: {
        async search({ keywords }) {
          searchCalls += 1;
          return { keywords, searches: [{ keyword: keywords[0], success: true, count: 1 }],
            notes: [{ id: 'new', title: '静安书店散步', url: 'https://example.test/new', matchedKeywords: keywords }], count: 1 };
        },
        async readDetails({ notes }) { return { details: notes.map((note) => ({ ...note, description: '书店旁适合散步。' })), failures: [] }; },
      },
      orchestrator: {},
      researcher: {
        async analyze({ notes }) { analyses += 1; return { sufficient: notes.length > 1, groups: [{ key: 'g' }] }; },
        async planDetailReads() { return { noteIds: ['new'] }; },
      },
      curator: { async compose({ notes }) { return { cards: notes.length > 1
        ? [{ id: 'a' }, { id: 'b' }, { id: 'c' }] : [{ id: 'a' }] }; } },
      supplementalQueryPlanner: { async plan() { return { keyword: '上海 静安 书店散步', provider: 'test' }; } },
    });
    const result = await revision.revise({ runId, stage: 'cards', location: '上海 静安', request: '书店散步' });
    revisionId = result.run.id;
    assert.equal(searchCalls, 1);
    assert.equal(analyses, 2);
    assert.equal(result.output.cards.length, 3);
    assert.equal((await readCaptureStage(revisionId, 'evidence-notes')).length, 2);
  } finally {
    await rm(join(root, runId), { recursive: true, force: true });
    if (revisionId) await rm(join(root, revisionId), { recursive: true, force: true });
  }
});

test('修改接口接收共享入口的当前节点和完整要求', async () => {
  let received;
  const server = createDataServer({}, { revision: { async revise(input) { received = input; return { kind: 'cards' }; } },
    keywordAgent: {}, discovery: {}, orchestrator: {}, directionPlanner: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/discovery/revise`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'r1', stage: 'cards', location: '上海 静安', request: '安静散步' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.kind, 'cards');
    assert.equal(received.stage, 'cards');
    assert.equal(received.request, '安静散步');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('修改地点时创建新运行，不把旧地点笔记带入', async () => {
  const runId = await fixture();
  let revisionId;
  try {
    const revision = createRevisionService({
      keywordAgent: {}, discovery: {},
      orchestrator: { async run(input) {
        revisionId = input.runId;
        return { run: { id: input.runId }, output: {
          keywordPlan: { brief: { location: input.location, request: input.request } },
          searchResult: { notes: [{ id: 'new-city' }] }, cards: [], quality: { status: 'partial' },
        } };
      } },
    });
    const result = await revision.revise({ runId, stage: 'detail', cardId: 'old-card',
      location: '杭州西湖', request: '想去公园散步' });
    assert.equal(result.kind, 'cards');
    assert.equal(result.newLocation, true);
    assert.deepEqual(result.output.searchResult.notes.map((note) => note.id), ['new-city']);
  } finally {
    await rm(join(root, runId), { recursive: true, force: true });
    if (revisionId) await rm(join(root, revisionId), { recursive: true, force: true });
  }
});

test('缓存模式补搜未命中时标明缓存缺口并保留原笔记', async () => {
  const runId = await fixture();
  let revisionId;
  try {
    const revision = createRevisionService({
      supplementalSearchEnabled: true,
      keywordAgent: { generate: async ({ location, request }) => ({ brief: { location, request }, facets: ['walk'] }) },
      discovery: { async search({ runId: newRunId }) {
        revisionId = newRunId;
        await captureStage(newRunId, 'search-1', { error: { code: 'CACHE_MISS' } });
        throw new Error('所有小红书关键词搜索均失败');
      } },
      orchestrator: {},
      researcher: { async analyze() { return { sufficient: false, groups: [], unmetRequirements: [] }; } },
      curator: { async compose() { return { cards: [] }; } },
      supplementalQueryPlanner: { async plan() { return { keyword: '上海 静安 书店', provider: 'test' }; } },
    });
    const result = await revision.revise({ runId, stage: 'cards', location: '上海 静安', request: '想逛书店' });
    assert.equal(result.output.searchResult.count, 1);
    assert.equal(result.output.searchResult.quality.status, 'partial');
    assert.equal(result.output.searchResult.searches.at(-1).error.code, 'CACHE_MISS');
    assert.match(result.output.quality.message, /本地没有.*缓存/);
  } finally {
    await rm(join(root, runId), { recursive: true, force: true });
    if (revisionId) await rm(join(root, revisionId), { recursive: true, force: true });
  }
});

test('默认只规划补证检索词，不触发真实补搜', async () => {
  const runId = await fixture();
  let revisionId;
  try {
    const revision = createRevisionService({
      supplementalSearchEnabled: false,
      keywordAgent: { generate: async ({ location, request }) => ({ brief: { location, request }, facets: ['walk'] }) },
      discovery: { async search() { throw new Error('默认不应搜索'); } },
      orchestrator: {},
      researcher: { async analyze() { return { sufficient: false, groups: [], unmetRequirements: [] }; } },
      curator: { async compose() { return { cards: [] }; } },
      supplementalQueryPlanner: { async plan() { return { keyword: '上海 静安 书店', provider: 'test' }; } },
    });
    const result = await revision.revise({ runId, stage: 'cards', location: '上海 静安', request: '想逛书店' });
    revisionId = result.run.id;
    assert.equal(result.supplementalDeferred, true);
    assert.equal(result.searchAttempted, false);
    assert.deepEqual(result.output.searchResult.keywords, ['上海 静安 散步']);
    assert.match(result.output.quality.message, /待评测数据接入/);
  } finally {
    await rm(join(root, runId), { recursive: true, force: true });
    if (revisionId) await rm(join(root, revisionId), { recursive: true, force: true });
  }
});
