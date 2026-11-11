import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createKeywordAgent } from '../src/agents/keyword.js';
import { createDiscoveryOrchestrator } from '../src/agents/discovery-orchestrator.js';
import { createDiscoveryService } from '../src/discovery.js';
import { createDataServer } from '../src/server.js';
import { createResearcherAgent } from '../src/agents/researcher.js';
import { createDirectionPlanner } from '../src/agents/direction-planner.js';
import { createCuratorAgent } from '../src/agents/curator.js';

test('关键词 Agent 在未配置模型时生成去重的本地关键词', async () => {
  const agent = createKeywordAgent({ apiUrl: '' });
  const result = await agent.generate({
    location: '上海 · 静安',
    request: '今天下午想安静散步，别太商业化',
  });
  assert.equal(result.provider, 'fallback');
  assert.ok(result.keywords.length >= 2);
  assert.equal(result.keywords.length, 2);
  assert.equal(result.keywords[0], '上海 静安 好去处');
  assert.ok(result.keywords.some((keyword) => keyword.includes('安静散步')));
  assert.ok(result.facets.includes('local'));
});

test('Planner 保留小酌主需求，并提取夜间、同学、氛围和散步条件', async () => {
  const agent = createKeywordAgent({ apiUrl: '' });
  const result = await agent.generate({
    location: '北京海淀',
    request: '晚上想出去小酌两杯，和同学，安静点的或者燥一点的都可以，能走走逛逛就更好',
  });
  assert.deepEqual(result.facets, ['quiet', 'drinks', 'evening', 'classmates', 'lively', 'walk', 'flexible_vibe']);
  assert.equal(result.keywords.length, 2);
  assert.ok(result.keywords.every((keyword) => /酒吧|酒馆|小酌|精酿/.test(keyword)));
});

test('关键词 Agent 以 DeepSeek Chat Completions 格式请求并解析 JSON', async () => {
  let captured;
  const agent = createKeywordAgent({
    provider: 'deepseek',
    apiUrl: 'https://api.deepseek.com/chat/completions',
    apiKey: 'test-key',
    model: 'deepseek-flash',
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"keywords":["上海 静安 散步","上海 静安 书店"],"reason":"覆盖散步与文化偏好"}' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const result = await agent.generate({ location: '上海 · 静安', request: '想散步看书店' });
  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(captured.options.headers.Authorization, 'Bearer test-key');
  assert.equal(captured.body.model, 'deepseek-flash');
  assert.deepEqual(captured.body.response_format, { type: 'json_object' });
  assert.deepEqual(captured.body.thinking, { type: 'disabled' });
  assert.equal(result.provider, 'deepseek');
  assert.equal(result.model, 'deepseek-flash');
  assert.equal(result.keywords.length, 2);
  assert.ok(result.keywords.some((keyword) => keyword.includes('散步')));
});

test('关键词 Agent 没有密钥时不会发起模型请求', async () => {
  let called = false;
  const agent = createKeywordAgent({
    provider: 'deepseek',
    apiUrl: 'https://api.deepseek.com/chat/completions',
    apiKey: '',
    fetchImpl: async () => {
      called = true;
      throw new Error('不应调用');
    },
  });
  const result = await agent.generate({ location: '上海', request: '散步' });
  assert.equal(called, false);
  assert.equal(result.provider, 'fallback');
});

test('Planner 直接采用模型的两个关键词，不把不喝酒误判成咖啡', async () => {
  const agent = createKeywordAgent({
    apiUrl: 'https://example.test/chat/completions', apiKey: 'test-key',
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      keywords: ['越秀 老城区 夜间散步', '越秀 晚上 朋友 逛街区'],
    }) } }] }), { status: 200 }),
  });
  const result = await agent.generate({ location: '广州 · 越秀', request: '和朋友今晚逛会儿，不喝酒' });
  assert.deepEqual(result.keywords, ['越秀 老城区 夜间散步', '越秀 晚上 朋友 逛街区']);
  assert.ok(!result.facets.includes('coffee'));
  assert.equal(result.keywords.length, 2);
});

test('Planner 遇到仅词序不同的关键词时请模型重写一次', async () => {
  let calls = 0;
  const agent = createKeywordAgent({
    apiUrl: 'https://example.test/chat/completions', apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1;
      const keywords = calls === 1 ? ['静安 书店 咖啡', '静安 咖啡 书店']
        : ['静安 书店 约会', '静安 咖啡 约会'];
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ keywords }) } }] }), { status: 200 });
    },
  });
  const result = await agent.generate({ location: '上海 · 静安', request: '约会逛书店喝咖啡' });
  assert.equal(calls, 2);
  assert.deepEqual(result.keywords, ['静安 书店 约会', '静安 咖啡 约会']);
});

test('Planner 将吃饭和咖啡办公拆成不同检索主题', async () => {
  let calls = 0;
  const agent = createKeywordAgent({
    apiUrl: 'https://example.test/chat/completions', apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      assert.match(body.messages[1].content, /吃饭或简餐/);
      const keywords = calls === 1
        ? ['北京海淀北航 网球后简餐 咖啡店办公', '北京海淀北航 运动后轻食 咖啡馆工作']
        : ['北京海淀北航 网球后简餐', '北京海淀北航 咖啡店办公'];
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ keywords }) } }] }), { status: 200 });
    },
  });
  const result = await agent.generate({ location: '北京海淀北航', request: '打完网球随便吃点东西，然后找个咖啡店办公' });
  assert.equal(calls, 2);
  assert.deepEqual(result.keywords, ['北京海淀北航 网球后简餐', '北京海淀北航 咖啡店办公']);
  assert.deepEqual(result.strategy.searchAngles, ['dining', 'coffee_work']);
});

test('Planner 两次仍把温泉和咖啡捆在一起时使用分主题兜底词', async () => {
  let calls = 0;
  const agent = createKeywordAgent({
    apiUrl: 'https://example.test/chat/completions', apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        keywords: ['保山隆阳区温泉咖啡店', '隆阳区泡温泉喝咖啡去处'],
      }) } }] }), { status: 200 });
    },
  });
  const result = await agent.generate({ location: '云南保山隆阳区', request: '想去一个又能泡温泉又能喝咖啡的地方' });
  assert.equal(calls, 2);
  assert.equal(result.provider, 'fallback');
  assert.match(result.keywords[0], /温泉/);
  assert.doesNotMatch(result.keywords[0], /咖啡/);
  assert.match(result.keywords[1], /咖啡/);
});

test('Planner 无模型时也区分餐饮和工作地点', async () => {
  const agent = createKeywordAgent({ apiUrl: '' });
  const result = await agent.generate({ location: '北京海淀北航', request: '打完网球吃点东西，再找个能工作的地方' });
  assert.match(result.keywords[0], /简餐/);
  assert.doesNotMatch(result.keywords[0], /工作|办公|咖啡/);
  assert.match(result.keywords[1], /办公/);
});

test('Planner 模型只返回一个关键词时明确失败', async () => {
  const agent = createKeywordAgent({
    apiUrl: 'https://example.test/chat/completions', apiKey: 'test-key',
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"keywords":["越秀 夜游"]}' } }] }), { status: 200 }),
  });
  await assert.rejects(agent.generate({ location: '广州 · 越秀', request: '晚上散步' }), { code: 'INVALID_MODEL_KEYWORDS' });
});

test('多关键词搜索会去重笔记并保留命中的关键词', async () => {
  const data = {
    async searchNotes(keyword) {
      if (keyword === '失败词') throw Object.assign(new Error('上游失败'), { code: 'UPSTREAM_ERROR' });
      return {
        count: 2,
        notes: [
          { id: 'same', title: '共同结果' },
          { id: `only-${keyword}`, title: `${keyword}结果` },
        ],
      };
    },
  };
  const service = createDiscoveryService({ data });
  const result = await service.search({ keywords: ['上海', '上海 散步'] });
  assert.equal(result.searches.length, 2);
  assert.equal(result.count, 3);
  assert.deepEqual(result.notes.find((note) => note.id === 'same').matchedKeywords, ['上海', '上海 散步']);
  const partial = await service.search({ keywords: ['上海', '失败词'] });
  assert.equal(partial.searches[1].success, false);
  assert.equal(partial.quality.status, 'partial');
});

test('编排 Agent 记录子 Agent 与工具调用轨迹', async () => {
  const keywordAgent = createKeywordAgent({ apiUrl: '' });
  const discovery = createDiscoveryService({
    data: {
      async searchNotes(keyword) {
        return { count: 1, notes: [{ id: keyword, title: keyword }] };
      },
    },
  });
  const researcher = createResearcherAgent({ model: { configured: false } });
  const curator = createCuratorAgent({ model: { configured: false } });
  const orchestrator = createDiscoveryOrchestrator({ keywordAgent, discovery, researcher, curator });
  const result = await orchestrator.run({ location: '上海', request: '安静散步' });
  assert.equal(result.run.agent, 'discovery-orchestrator');
  assert.ok(result.output.keywordPlan.run.id);
  assert.ok(result.trace.some((item) => item.step === 'tool_call'));
  assert.ok(result.output.searchResult.count >= 1);
});

test('研究 Agent 过滤无关笔记，编辑 Agent 只能引用真实来源', async () => {
  const notes = [
    { id: 'r1', title: '上海静安苏州河散步', description: '在静安苏州河边散步', url: 'https://example.test/r1' },
    { id: 's1', title: '上海静安愚园路街区漫步', description: '在静安愚园路漫步', url: 'https://example.test/s1' },
    { id: 'q1', title: '上海静安人少安静的小路', description: '静安人少的小路适合散步', url: 'https://example.test/q1' },
    { id: 'bad', title: '古文成语积累', url: 'https://example.test/bad' },
  ];
  const brief = { location: '上海 静安', request: '安静散步' };
  const researcher = createResearcherAgent({ model: { configured: true, async complete(_system, input) {
    assert.equal(input.candidates.some((note) => note.id === 'bad'), false);
    return { groups: input.candidates.map((note) => ({ key: note.id, theme: note.title,
      decisionAnchor: note.title, action: '散步', noteIds: [note.id] })) };
  } } });
  const research = await researcher.analyze({ brief, notes });
  assert.equal(research.relevantCount, 3);
  assert.equal(research.rejectedCount, 1);
  const curator = createCuratorAgent({ model: {
    configured: true,
    async complete() {
      return { cards: [{ groupKey: research.groups[0].key, title: '河边慢走', sourceIds: ['r1', 'invented'] }] };
    },
  } });
  const result = await curator.compose({ brief, groups: research.groups, notes });
  assert.deepEqual(result.cards[0].sources.map((source) => source.id), ['r1']);
  assert.equal(result.cards.length, 3);
});

test('研究模型失败时不会用规则凑卡', async () => {
  const brief = { location: '杭州西湖', facets: ['drinks', 'walk'], request: '晚上和朋友小酌，随后散步' };
  const notes = [
    { id: 'bar', title: '杭州湖滨精酿酒吧小酌', description: '和朋友在湖滨酒吧聊天', url: 'https://example.test/bar', matchedKeywords: ['杭州西湖 酒吧'] },
    { id: 'route', title: '杭州西湖夜游路线', description: '先在湖滨酒吧小酌，再步行到湖边', url: 'https://example.test/route' },
    { id: 'park', title: '杭州西湖公园草坪散步', description: '公园草坪适合散步休闲', url: 'https://example.test/park' },
  ];
  const research = await createResearcherAgent({ model: { configured: true,
    async complete() { throw new Error('timeout'); } } }).analyze({ brief, notes });
  assert.deepEqual(research.groups, []);
  assert.equal(research.sufficient, false);
  assert.equal(research.warning, 'timeout');
});

test('仅有标题的笔记不能成为卡片来源，编辑不能更换已选地点', async () => {
  const notes = [
    { id: 'body', title: '西城书店', description: '西城书店室内阅读', url: 'https://example.test/body' },
    { id: 'title', title: '海淀公园', url: 'https://example.test/title' },
  ];
  const groups = [
    { key: 'valid', theme: '看书', decisionAnchor: '西城书店', action: '室内看书', noteIds: ['body'] },
    { key: 'invalid', theme: '公园', decisionAnchor: '海淀公园', action: '户外散步', noteIds: ['title'] },
  ];
  const researcher = createResearcherAgent({ model: { configured: true, async complete(_system, input) {
    assert.deepEqual(input.candidates.map((note) => note.id), ['body']);
    return { groups };
  } } });
  const research = await researcher.analyze({ brief: { location: '北京 · 西城', request: '室内看书' }, notes });
  assert.deepEqual(research.groups.map((group) => group.key), ['valid']);
  const curator = createCuratorAgent({ model: { configured: true, async complete() {
    return { cards: [{ groupKey: 'valid', decisionAnchor: '海淀公园', action: '户外散步', sourceIds: ['body', 'title'] }] };
  } } });
  const result = await curator.compose({ brief: {}, groups, notes });
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].decisionAnchor, '西城书店');
  assert.equal(result.cards[0].action, '室内看书');
  assert.deepEqual(result.cards[0].sources.map((source) => source.id), ['body']);
});

test('选中方向的轻行程只能引用该卡笔记正文中的原句', async () => {
  const card = { decisionType: 'place', decisionAnchor: '湖滨', action: '小酌后散步', sources: [{ id: 'n1' }] };
  const notes = [
    { id: 'n1', title: '湖滨夜游', description: '先在湖滨酒吧小酌，再沿湖边散步。' },
    { id: 'n2', title: '另一区域', description: '这里可以随意安排活动。' },
  ];
  const model = { configured: true, async complete() { return { steps: [
    { place: '湖滨', action: '在酒吧小酌', sourceId: 'n1', excerpt: '先在湖滨酒吧小酌' },
    { place: '湖边', action: '另一个落点', sourceId: 'n1', excerpt: '再沿湖边散步' },
    { place: '湖滨', action: '虚构活动', sourceId: 'n1', excerpt: '不存在的原句' },
    { place: '另一区域', action: '跨区活动', sourceId: 'n2', excerpt: '这里可以随意安排活动' },
  ] }; } };
  const plan = await createDirectionPlanner({ model }).plan({ brief: {}, card, notes });
  assert.equal(plan.notesRead, 1);
  assert.deepEqual(plan.steps.map((step) => step.sourceId), ['n1']);
  assert.equal(plan.steps[0].excerpt, '先在湖滨酒吧小酌');
});

const provider = {
  async searchNotes(keyword) {
    return { count: 1, notes: [{ id: `note-${keyword}`, title: keyword }] };
  },
};
const keywordAgent = {
  async generate(brief) {
    return { brief, keywords: [`${brief.location} 散步`], provider: 'test' };
  },
};
const discovery = createDiscoveryService({ data: provider });
const server = createDataServer(provider, { keywordAgent, discovery });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
after(() => server.close());
const base = `http://127.0.0.1:${server.address().port}`;

test('HTTP 接口按关键词生成与搜索两步返回数据', async () => {
  const keywordsResponse = await fetch(`${base}/api/discovery/keywords`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: '上海', request: '安静散步' }),
  });
  const keywordsPayload = await keywordsResponse.json();
  assert.equal(keywordsPayload.data.keywords[0], '上海 散步');

  const searchResponse = await fetch(`${base}/api/discovery/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords: keywordsPayload.data.keywords }),
  });
  const searchPayload = await searchResponse.json();
  assert.equal(searchPayload.data.count, 1);
  assert.equal(searchPayload.data.notes[0].matchedKeywords[0], '上海 散步');
});

test('配置状态接口不泄露模型密钥', async () => {
  const response = await fetch(`${base}/api/config/model`);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(typeof payload.data.configured, 'boolean');
  assert.equal('apiKey' in payload.data, false);
  assert.equal(JSON.stringify(payload).includes('test-key'), false);
});
