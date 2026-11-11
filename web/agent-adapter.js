/**
 * Frontend discovery contract.
 *
 * Adapters expose: async *discover(brief, { signal })
 * The UI only consumes events and does not know whether the implementation
 * uses HTTP, SSE, WebSocket, a local mock, or another Agent runtime.
 */

export const DISCOVERY_STAGES = ['keywords', 'retrieve', 'results'];

const DEFAULT_API_BASE = window.location.origin;
const CACHED_API_BASE = 'http://127.0.0.1:3101';

function resolveApiBase() {
  if (window.GOGOGO_API_BASE_URL) return window.GOGOGO_API_BASE_URL;
  const params = new URLSearchParams(window.location.search);
  if (params.get('cached') === '1') return CACHED_API_BASE;
  return DEFAULT_API_BASE;
}

async function requestJson(url, method, body, signal) {
  const token = sessionStorage.getItem('gogogo-trial-token');
  const mode = sessionStorage.getItem('gogogo-api-mode');
  if (!token && new URLSearchParams(window.location.search).get('cached') !== '1') {
    window.location.assign('./settings.html');
    throw new Error('请先选择 API 使用方式');
  }
  const ownKey = mode === 'own' ? sessionStorage.getItem('gogogo-own-api-key') : null;
  const ownUrl = mode === 'own' ? sessionStorage.getItem('gogogo-own-api-url') : null;
  const ownModel = mode === 'own' ? sessionStorage.getItem('gogogo-own-model') : null;
  if (mode === 'own' && (!ownKey || !ownUrl || !ownModel)) throw new Error('请在 API 设置中补全接口 URL、模型和 Key');
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ownKey ? { 'X-Model-Api-Key': ownKey, 'X-Model-Api-Url': ownUrl, 'X-Model-Name': ownModel } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (response.status === 401 && payload?.error?.code === 'UNAUTHORIZED') sessionStorage.removeItem('gogogo-trial-token');
  if (!response.ok || payload?.success !== true) {
    const error = new Error(payload?.error?.message || `请求失败 (${response.status})`);
    error.code = payload?.error?.code || 'HTTP_ERROR';
    throw error;
  }
  return payload.data;
}

const postJson = (url, body, signal) => requestJson(url, 'POST', body, signal);
const getJson = (url, signal) => requestJson(url, 'GET', null, signal);

export class ApiDiscoveryAgent {
  constructor({ apiBaseUrl = resolveApiBase() } = {}) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
  }

  async planDirection(runId, cardId, { signal } = {}) {
    const started = await postJson(`${this.apiBaseUrl}/api/discovery/plan/start`, { runId, cardId }, signal);
    if (started.state === 'done') return started.result;
    while (true) {
      await wait(1500, signal);
      const status = await getJson(`${this.apiBaseUrl}/api/discovery/plan/status?runId=${encodeURIComponent(runId)}&cardId=${encodeURIComponent(cardId)}`, signal);
      if (status.state === 'done') return status.result;
      if (status.state === 'failed') throw new Error(status.error?.message || '细化方案未能完成，请重试');
    }
  }

  async revise(input, { signal } = {}) {
    return postJson(`${this.apiBaseUrl}/api/discovery/revise`, input, signal);
  }

  async *discover(brief, { signal } = {}) {
    const runId = crypto.randomUUID();
    yield { type: 'stage.started', stage: 'keywords', message: '正在理解需求并生成检索词…' };
    await postJson(`${this.apiBaseUrl}/api/discovery/start`, { ...brief, runId }, signal);
    let keywordsDone = false;
    let retrieveDone = false;
    let lastProgress = '';
    let result;
    while (!result) {
      const status = await getJson(`${this.apiBaseUrl}/api/discovery/status?runId=${encodeURIComponent(runId)}`, signal);
      if (status.completedStages.includes('keywords') && !keywordsDone) {
        yield { type: 'keywords.ready', keywordPlan: status.keywordPlan };
        yield { type: 'stage.completed', stage: 'keywords', data: status.keywordPlan };
        yield { type: 'stage.started', stage: 'retrieve', message: '正在搜索小红书笔记…' };
        keywordsDone = true;
      }
      if (status.completedStages.includes('retrieve') && !retrieveDone) {
        yield { type: 'stage.completed', stage: 'retrieve' };
        yield { type: 'stage.started', stage: 'results', message: '正在筛选证据并整理三个方向…' };
        retrieveDone = true;
      }
      if (status.progress?.message && status.progress.message !== lastProgress) {
        lastProgress = status.progress.message;
        yield { type: 'progress.updated', progress: status.progress, updates: status.updates || [] };
      }
      if (status.state === 'failed') {
        const error = new Error(status.error?.message || '这次搜索未能完成，请重试');
        error.code = status.error?.code || 'RUN_FAILED';
        throw error;
      }
      if (status.state === 'done') result = status.result;
      else await wait(1500, signal);
    }
    const { keywordPlan, searchResult, cards, quality } = result.output;
    yield { type: 'discovery.results', keywordPlan, searchResult, cards, quality, runId: result.run.id };
    yield { type: 'stage.completed', stage: 'results', data: { count: cards.length } };
  }
}

const MOCK_NOTES = [
  { id: 'mock-1', title: '静安梧桐区半日散步路线', author: { nickname: '城市散步者' }, coverUrl: './assets/street-cafe.png', url: '#', stats: { likes: '1.2万', comments: '328', favorites: '2640' }, matchedKeywords: ['上海 静安', '上海 静安 安静散步'] },
  { id: 'mock-2', title: '上海值得慢慢逛的独立书店', author: { nickname: '周末编辑部' }, coverUrl: './assets/design-bookstore.png', url: '#', stats: { likes: '8360', comments: '129', favorites: '1890' }, matchedKeywords: ['上海 静安 小众去处'] },
  { id: 'mock-3', title: '黄昏时分的城市散步灵感', author: { nickname: '在地生活录' }, coverUrl: './assets/riverside-sunset.png', url: '#', stats: { likes: '5690', comments: '88', favorites: '1204' }, matchedKeywords: ['上海 静安 安静散步'] },
];

function mockCards(brief) {
  return MOCK_NOTES.map((note, index) => ({
    id: `mock-card-${index + 1}`,
    title: ['街区慢走', '书店与展览', '黄昏河边'][index],
    hook: note.title,
    whyThis: `演示方向：${brief.request || '在附近走走'}`,
    sources: [{ id: note.id, title: note.title, url: note.url, coverUrl: note.coverUrl }],
  }));
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Discovery cancelled', 'AbortError'));
    }, { once: true });
  });
}

export class MockDiscoveryAgent {
  async planDirection() {
    return { steps: [], notesRead: 0, limitation: '模拟笔记只有标题，不能生成有原文依据的详细步骤。' };
  }

  async revise({ stage, location, request }) {
    const brief = { location, request };
    const cards = mockCards(brief);
    return { kind: stage, run: { id: `mock-revision-${crypto.randomUUID()}` },
      searchAttempted: false, supplementalKeyword: '',
      output: { keywordPlan: { brief, keywords: [] },
        searchResult: { count: MOCK_NOTES.length, notes: MOCK_NOTES, searches: [], keywords: [], quality: { status: 'complete', failedQueries: 0 } },
        cards,
        quality: stage === 'detail'
          ? { status: 'partial', message: '模拟笔记没有正文，无法可靠细化方案' }
          : { status: 'complete', message: '' },
      } };
  }

  async *discover(brief, { signal } = {}) {
    const place = brief.location.replace(/[·,，/]+/g, ' ').replace(/\s+/g, ' ').trim();
    const keywordPlan = { brief, keywords: [`${place} 好去处`, `${place} 安静散步`], provider: 'mock', reason: '前端演示数据' };
    yield { type: 'stage.started', stage: 'keywords', message: '正在分析地点和个性化需求…' };
    await wait(650, signal);
    yield { type: 'keywords.ready', keywordPlan };
    yield { type: 'stage.completed', stage: 'keywords', data: keywordPlan };
    yield { type: 'stage.started', stage: 'retrieve', message: '正在使用这些关键词搜索小红书…' };
    await wait(900, signal);
    yield { type: 'stage.completed', stage: 'retrieve', data: [] };
    yield { type: 'stage.started', stage: 'results', message: '正在合并重复笔记并整理返回结果…' };
    await wait(450, signal);
    const cards = mockCards(brief);
    yield { type: 'discovery.results', keywordPlan, searchResult: { count: MOCK_NOTES.length, notes: MOCK_NOTES, searches: [] }, cards, quality: { status: 'complete' }, runId: 'mock' };
    yield { type: 'stage.completed', stage: 'results', data: { count: cards.length } };
  }
}

export function createDiscoveryAgent() {
  const injected = window.gogogoAgentAdapter;
  if (injected && typeof injected.discover === 'function') return injected;
  const useMock = new URLSearchParams(window.location.search).get('mock') === '1';
  return useMock ? new MockDiscoveryAgent() : new ApiDiscoveryAgent();
}
