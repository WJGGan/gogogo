/** Replays the saved Beijing search results through detail research and curation. */
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from '../src/config/env.js';
import { createDiscoveryService } from '../src/discovery.js';
import { createLocalXiaohongshuData } from '../src/data/local-xiaohongshu.js';
import { createDiscoveryOrchestrator } from '../src/agents/discovery-orchestrator.js';
import { createKeywordAgent } from '../src/agents/keyword.js';

loadEnvFile();
const data = createLocalXiaohongshuData();
const planner = createKeywordAgent();
const orchestrator = createDiscoveryOrchestrator({
  keywordAgent: {
    async generate(input) {
      const plan = await planner.generate(input);
      return { ...plan, keywords: ['北京海淀 好去处', '北京海淀 安静散步'], reason: '回放本次已保存的真实搜索结果；不触发新搜索' };
    },
  },
  discovery: createDiscoveryService({ data }),
});
const input = {
  runId: randomUUID(),
  location: '北京海淀',
  request: '晚上想出去小酌两杯，和同学，安静点的或者燥一点的都可以，能走走逛逛就更好',
};
try {
  const result = await orchestrator.run(input);
  console.log(JSON.stringify({
    runId: result.run.id,
    planner: { model: result.output.keywordPlan.model, facets: result.output.keywordPlan.facets,
      recommendedKeywords: result.output.keywordPlan.keywords },
    searches: result.output.searchResult.searches.map(({ keyword, count, success }) => ({ keyword, count, success })),
    details: result.output.detailResult,
    researcher: { model: result.output.research.provider, relevant: result.output.research.relevantCount,
      detailNotes: result.output.research.detailNoteCount, groups: result.output.research.groups.map((group) => group.theme) },
    curator: { model: result.output.curation.provider, cards: result.output.cards.map((card) => ({
      title: card.title, angle: card.angle, evidenceLevel: card.evidenceLevel,
      sources: card.sources.map((source) => source.title),
    })) },
    quality: result.output.quality,
  }, null, 2));
} finally {
  data.close();
}
