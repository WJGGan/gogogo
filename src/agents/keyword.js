import { DataError } from '../data/xiaohongshu.js';
import { createAgentRun } from './runtime.js';
import { currentModelCredential } from './model-credential.js';

const AGENT_NAME = 'keyword-agent';
const AGENT_VERSION = '0.6.0';
const MAX_KEYWORDS = 2;

const SEARCH_LENSES = [
  { name: 'hot_spring', label: '温泉体验', pattern: /温泉|汤泉|泡汤/, fallback: '温泉体验' },
  { name: 'dining', label: '吃饭或简餐', pattern: /吃饭|吃点|用餐|简餐|轻食|美食|餐厅|餐馆|小吃|夜宵|火锅|烧烤/, fallback: '附近简餐' },
  { name: 'drinks', label: '小酌或酒馆', pattern: /小酌|喝两杯|喝一杯|酒吧|酒馆|精酿|微醺|鸡尾酒/, fallback: '适合小酌的酒馆' },
  { name: 'coffee_work', label: '咖啡或办公地点', pattern: /咖啡|办公|自习|工作/, fallback: '适合办公的咖啡店' },
  { name: 'culture', label: '书店或展览', pattern: /书店|展览|艺术馆|博物馆|文化空间/, fallback: '书店展览' },
  { name: 'walk', label: '散步或街区路线', pattern: /走走|逛逛|散步|漫步|city.?walk|街区|夜游/, fallback: '散步路线' },
];

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DataError('INVALID_INPUT', `${field} 不能为空`, 400);
  }
  return value.trim();
}

function unique(items, limit = MAX_KEYWORDS) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

function compactLocation(location) {
  return location.replace(/[·,，/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function searchLenses(request) {
  const found = SEARCH_LENSES.map((lens) => ({ ...lens, position: request.search(lens.pattern) }))
    .filter((lens) => lens.position >= 0);
  const specific = found.filter((lens) => lens.name !== 'walk').sort((a, b) => a.position - b.position);
  if (specific.length >= MAX_KEYWORDS) return specific.slice(0, MAX_KEYWORDS);
  return [...specific, ...found.filter((lens) => lens.name === 'walk')]
    .sort((a, b) => a.position - b.position).slice(0, MAX_KEYWORDS);
}

function lensFallback(lens, request, previousLens) {
  if (lens.name === 'dining' && /网球|打球|运动|健身/.test(request)) return '运动后简餐';
  if (lens.name === 'coffee_work') return /咖啡/.test(request)
    ? (previousLens?.name === 'hot_spring' ? '温泉附近咖啡店' : /办公|自习|工作/.test(request) ? '适合办公的咖啡店' : '咖啡店')
    : '安静办公地点';
  if (lens.name === 'walk' && previousLens?.name === 'drinks') return '小酌后夜游散步';
  if (lens.name === 'walk' && /安静|放松|慢慢/.test(request)) return '安静散步路线';
  return lens.fallback;
}

function normalizedTopic(keyword, location) {
  const place = compactLocation(location).replace(/\s+/g, '').toLowerCase();
  return keyword.toLowerCase().replace(/\s+/g, '').replace(place, '')
    .replace(/咖啡馆|咖啡厅|咖啡店/g, '咖啡')
    .replace(/办公|工作|自习/g, '办公')
    .replace(/轻食|简餐|吃饭|用餐|餐厅|餐馆/g, '餐饮')
    .replace(/漫步|走走|逛逛|citywalk/g, '散步')
    .replace(/泡温泉|汤泉|泡汤/g, '温泉')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function topicSimilarity(first, second) {
  if (!first || !second) return 0;
  if (first === second) return 1;
  if (Math.min(first.length, second.length) >= 3 && (first.includes(second) || second.includes(first))) return 1;
  const grams = (value) => new Set([...value].slice(0, -1).map((char, index) => char + [...value][index + 1]));
  const a = grams(first);
  const b = grams(second);
  const overlap = [...a].filter((gram) => b.has(gram)).length;
  return 2 * overlap / (a.size + b.size || 1);
}

function diversityIssue(keywords, brief, lenses) {
  const [first, second] = keywords;
  const bag = (keyword) => keyword.toLocaleLowerCase().split(/\s+/).sort().join(' ');
  if (bag(first) === bag(second)) return '两个关键词仅词序不同';
  if (topicSimilarity(normalizedTopic(first, brief.location), normalizedTopic(second, brief.location)) >= 0.72)
    return '两个关键词的检索主题过于相近';
  if (lenses.length === MAX_KEYWORDS) {
    const [primary, secondary] = lenses;
    if (!primary.pattern.test(first) || secondary.pattern.test(first) || !secondary.pattern.test(second))
      return `第一词应只检索${primary.label}，第二词应重点检索${secondary.label}`;
  }
  return '';
}

function deriveFacets(request) {
  const facets = [];
  const rules = [
    ['quiet', /安静|放松|闲逛|散步|慢慢/],
    ['local', /小众|不.{0,2}商业|别.{0,2}商业|不.{0,2}热门/],
    ['coffee', /咖啡/],
    ['dining', /吃饭|吃点|用餐|简餐|轻食|美食|餐厅|餐馆|小吃|夜宵|火锅|烧烤/],
    ['hot_spring', /温泉|汤泉|泡汤/],
    ['culture', /书店|展览|艺术|文化/],
    ['indoor', /室内|下雨|雨天/],
    ['date', /约会|情侣/],
    ['solo', /一个人|独自/],
    ['drinks', /小酌|喝两杯|喝一杯|酒吧|酒馆|精酿|微醺|鸡尾酒/],
    ['evening', /晚上|夜里|夜间|今晚/],
    ['classmates', /同学/],
    ['friends', /朋友|同事|同伴|一起/],
    ['lively', /热闹|燥一点|蹦|livehouse|音乐/],
    ['walk', /走走|逛|散步|city.?walk|漫步/],
    ['green_space', /公园|草坪|河边|露营|野餐/],
    ['flexible_vibe', /都可以|都行|无所谓/],
    ['low_walk', /少走路|不想走|别走太多/],
  ];
  for (const [name, pattern] of rules) if (pattern.test(request)) facets.push(name);
  return facets;
}

function deriveRecommendationScope(request) {
  const wantsSpecificVenue = /具体.{0,4}(?:店|酒吧|酒馆|餐厅)|哪家(?:店|酒吧|酒馆)|推荐.{0,3}(?:一家|某家)|店名|指定.{0,3}(?:店|酒吧|酒馆)|就去.{0,5}(?:店|酒吧|酒馆)/.test(request);
  return wantsSpecificVenue
    ? { level: 'venue', reason: '用户明确要求具体店铺' }
    : { level: 'area', reason: '默认以区域或路线作为主推荐；有来源的店名可作为例子简要列出，选择后再看细节' };
}

function deriveIntentProfile(brief, facets, recommendationScope) {
  const primaryActivity = facets.includes('drinks') ? 'drinks'
    : facets.includes('dining') ? 'dining'
      : facets.includes('hot_spring') ? 'hot_spring'
        : facets.includes('coffee') ? 'coffee'
      : facets.includes('culture') ? 'culture'
        : facets.includes('walk') ? 'walk' : 'local_outing';
  const vibe = facets.includes('flexible_vibe') ? 'flexible'
    : facets.includes('lively') ? 'lively'
      : facets.includes('quiet') ? 'quiet' : 'unspecified';
  return {
    primaryActivity,
    companions: facets.filter((facet) => ['classmates', 'friends', 'date', 'solo'].includes(facet)),
    time: facets.includes('evening') ? 'evening' : 'unspecified',
    vibe,
    secondaryActivities: facets.filter((facet) => ['walk', 'green_space', 'culture', 'coffee', 'dining', 'hot_spring'].includes(facet) && facet !== primaryActivity),
    recommendationScope: recommendationScope.level,
    scopeReason: recommendationScope.reason,
    location: brief.location,
  };
}

function fallbackKeywords({ location, request = '' }) {
  const place = compactLocation(location);
  const text = request.trim();
  const lenses = searchLenses(text);
  if (lenses.length === MAX_KEYWORDS) return lenses.map((lens, index) =>
    `${place} ${lensFallback(lens, text, lenses[index - 1])}`);
  if (lenses[0]?.name === 'hot_spring') return [`${place} 温泉体验`, `${place} 温泉酒店`];
  if (lenses[0]?.name === 'dining') return [`${place} ${lensFallback(lenses[0], text)}`, `${place} 本地小吃`];
  if (lenses[0]?.name === 'coffee_work') return [`${place} ${lensFallback(lenses[0], text)}`, `${place} 安静自习空间`];
  const concepts = [];
  const drinks = /小酌|喝两杯|喝一杯|酒吧|酒馆|精酿|微醺|鸡尾酒/.test(text);
  if (drinks) {
    concepts.push(/同学|朋友|一起/.test(text) ? '精酿酒吧同学小酌' : '精酿酒吧小酌');
    concepts.push(/走走|逛逛|散步|漫步/.test(text) ? '小酌后夜游散步' : /燥|热闹|livehouse|音乐/.test(text) ? '热闹酒馆小酌' : '夜间酒馆小酌');
    return unique(concepts.map((concept) => `${place} ${concept}`), MAX_KEYWORDS);
  }
  if (/安静|放松|闲逛|散步|慢慢/.test(text)) concepts.push('安静散步');
  if (/小众|不.{0,2}商业|别.{0,2}商业|不.{0,2}热门/.test(text)) concepts.push('小众去处');
  if (/咖啡/.test(text)) concepts.push('咖啡散步');
  if (/书店|展览|艺术|文化/.test(text)) concepts.push('书店展览');
  if (/室内|下雨|雨天/.test(text)) concepts.push('室内去处');
  if (/约会|情侣/.test(text)) concepts.push('约会路线');
  const defaults = concepts.length ? concepts : ['散步', '周末去哪儿'];
  return unique([`${place} 好去处`, ...defaults.slice(0, 1).map((concept) => `${place} ${concept}`)], MAX_KEYWORDS);
}

function parseJsonObject(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || !Array.isArray(parsed.keywords)) throw new Error('模型响应缺少 keywords');
  return parsed;
}

function resolveProvider() {
  if (process.env.MODEL_PROVIDER) return process.env.MODEL_PROVIDER.trim().toLowerCase();
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
  return 'openai-compatible';
}

function resolveApiUrl(provider = resolveProvider()) {
  if (process.env.MODEL_API_URL) return process.env.MODEL_API_URL;
  if (provider === 'deepseek') return 'https://api.deepseek.com/chat/completions';
  if (process.env.OPENAI_BASE_URL) {
    return `${process.env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  }
  if (process.env.OPENAI_API_KEY || process.env.MODEL_API_KEY) {
    return 'https://api.openai.com/v1/chat/completions';
  }
  return '';
}

function resolveApiKey() {
  return process.env.DEEPSEEK_API_KEY || process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || '';
}

function resolveModel(provider = resolveProvider()) {
  if (provider === 'deepseek' && process.env.PLANNER_MODEL_NAME) return process.env.PLANNER_MODEL_NAME;
  if (process.env.MODEL_NAME) return process.env.MODEL_NAME;
  return provider === 'deepseek' ? 'deepseek-flash' : 'gpt-4.1-mini';
}

export function getKeywordAgentConfig() {
  const provider = resolveProvider();
  const apiKey = resolveApiKey();
  return {
    provider,
    model: resolveModel(provider),
    apiUrl: resolveApiUrl(provider),
    configured: Boolean(apiKey),
  };
}

export function createKeywordAgent({
  fetchImpl = fetch,
  provider = resolveProvider(),
  apiUrl = resolveApiUrl(provider),
  apiKey = resolveApiKey(),
  model = resolveModel(provider),
  timeoutMs = Number(process.env.MODEL_TIMEOUT_MS) || 30000,
} = {}) {
  async function generateWithModel(brief, lenses, feedback = '') {
    const effectiveKey = currentModelCredential()?.apiKey || apiKey;
    const effectiveUrl = currentModelCredential()?.apiUrl || apiUrl;
    const effectiveModel = currentModelCredential()?.model || model;
    const effectiveProvider = currentModelCredential()?.provider || provider;
    const response = await fetchImpl(effectiveUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(effectiveKey ? { Authorization: `Bearer ${effectiveKey}` } : {}),
      },
      body: JSON.stringify({
        model: effectiveModel,
        temperature: 0.2,
        max_tokens: 300,
        ...(effectiveProvider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你负责规划恰好两次小红书检索。每个词必须包含地点，简短、像真实用户会搜索的词，遵守否定要求。若需求包含两种活动，第一词只搜第一种，第二词重点搜另一种；不要在两个词里都堆入全部需求。若只有一种活动，改用不同场景或地点类型取证，不能仅替换同义词。只返回 JSON：{"keywords":["词1","词2"]}。',
          },
          { role: 'user', content: JSON.stringify({ ...brief,
            ...(lenses.length === MAX_KEYWORDS ? { searchFocus: [
              `第一词：只检索${lenses[0].label}，不要包含${lenses[1].label}`,
              `第二词：重点检索${lenses[1].label}，可把第一活动作为前后文`,
            ] } : {}),
            ...(feedback ? { feedback } : {}) }) },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`模型请求失败: ${response.status}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('模型响应缺少文本内容');
    const parsed = parseJsonObject(content);
    const keywords = parsed.keywords.map((item) => typeof item === 'string' ? item.trim() : '');
    if (keywords.length !== MAX_KEYWORDS || keywords.some((item) => !item)
      || new Set(keywords).size !== MAX_KEYWORDS) {
      throw new DataError('INVALID_MODEL_KEYWORDS', 'Planner 必须返回两个不同的非空关键词', 502);
    }
    const issue = diversityIssue(keywords, brief, lenses);
    if (issue) throw new DataError('DUPLICATE_MODEL_KEYWORDS', issue, 502);
    return {
      keywords,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      provider: effectiveProvider,
      model: effectiveModel,
    };
  }

  return {
    async generate(input) {
      const brief = {
        location: requiredString(input?.location, 'location'),
        request: typeof input?.request === 'string' ? input.request.trim() : '',
      };
      const run = createAgentRun(AGENT_NAME, brief);
      const place = compactLocation(brief.location);
      let facets = deriveFacets(brief.request);
      let recommendationScope = deriveRecommendationScope(brief.request);
      const deterministic = fallbackKeywords(brief);
      const lenses = searchLenses(brief.request);
      run.record('normalize_input', '归一化地点与自然语言需求', { place, requestLength: brief.request.length });
      run.record('select_strategy', '采用由宽到窄的查询策略并限制检索预算', {
        strategy: lenses.length === MAX_KEYWORDS ? 'distinct_search_focus' : 'broad_to_specific',
        queryBudget: MAX_KEYWORDS,
        searchFocus: lenses.map((lens) => lens.name),
      });

      let proposed = [];
      let provider = 'fallback';
      let reason = '未配置模型 API，使用本地策略生成关键词';
      let warning;
      let usedModel = '';
      if ((currentModelCredential()?.apiUrl || apiUrl) && (currentModelCredential()?.apiKey || apiKey)) {
        try {
          let result;
          try {
            result = await generateWithModel(brief, lenses);
          } catch (error) {
            if (error.code !== 'DUPLICATE_MODEL_KEYWORDS') throw error;
            run.record('rewrite_queries', '两个检索词缺乏区分度，要求模型重写', { issue: error.message });
            result = await generateWithModel(brief, lenses,
              `上次两个检索词不合格：${error.message}。请明确拆成不同检索主题，不要重复堆叠活动词。`);
          }
          proposed = result.keywords;
          provider = result.provider;
          reason = result.reason;
          usedModel = result.model;
          run.record('model_proposal', '模型提出候选检索词', { count: proposed.length, model: usedModel });
        } catch (error) {
          if (error instanceof DataError && error.code !== 'DUPLICATE_MODEL_KEYWORDS') throw error;
          warning = error.message;
          reason = error.code === 'DUPLICATE_MODEL_KEYWORDS'
            ? '模型两次给出相近搜索词，已改用不同主题的本地检索词'
            : '模型暂不可用，已使用本地策略生成关键词';
          run.record('model_fallback', '模型调用失败，切换到确定性策略', { error: warning });
        }
      }
      const keywords = provider === 'fallback' ? deterministic : proposed;
      if (keywords.length !== MAX_KEYWORDS) throw new DataError('INVALID_KEYWORD_PLAN', '关键词计划必须包含两个不同的关键词', 502);
      const intentProfile = deriveIntentProfile(brief, facets, recommendationScope);
      run.record('derive_facets', '提取需求特征', { facets, provider });
      run.record('derive_intent_profile', '区分主活动、补充偏好与推荐粒度', intentProfile);
      const searchAngles = lenses.length === MAX_KEYWORDS
        ? lenses.map((lens) => lens.name)
        : keywords.map((keyword) => /散步|漫步|city.?walk|路线|夜游|公园|草坪/.test(keyword)
          ? 'complementary_experience' : 'primary_activity');
      run.record('validate_queries', '校验两个非空且不同的关键词', {
        proposedCount: proposed.length,
        acceptedCount: keywords.length,
        searchAngles,
        recommendationScope: recommendationScope.level,
      });
      const completed = run.complete({ keywords }, { version: AGENT_VERSION, provider, model: usedModel || undefined });
      return {
        brief,
        keywords,
        facets,
        intentProfile,
        recommendationScope: recommendationScope.level,
        strategy: {
          name: 'primary_plus_complementary', queryBudget: MAX_KEYWORDS,
          recommendationScope: recommendationScope.level,
          searchAngles,
        },
        reason,
        provider,
        ...(usedModel ? { model: usedModel } : {}),
        ...(warning ? { warning } : {}),
        run: completed.run,
        trace: completed.trace,
      };
    },
  };
}
