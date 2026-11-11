/** Runs Researcher and Curator with saved XHS search data; no live XHS searches. */
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from '../src/config/env.js';
import { createDiscoveryService } from '../src/discovery.js';
import { createLocalXiaohongshuData } from '../src/data/local-xiaohongshu.js';
import { createDiscoveryOrchestrator } from '../src/agents/discovery-orchestrator.js';
import { captureStage } from '../src/data/run-captures.js';

loadEnvFile();
const data = createLocalXiaohongshuData();
const brief = { location: '上海 · 静安', request: '想一个人安静散步，别太商业化。', runId: randomUUID() };
const keywordAgent = {
  async generate(input) {
    return { brief: { location: input.location, request: input.request },
      keywords: ['上海 静安', '静安 散步路线'], provider: 'saved-search-fixture' };
  },
};

try {
  const orchestrator = createDiscoveryOrchestrator({
    keywordAgent,
    discovery: createDiscoveryService({ data }),
  });
  const result = await orchestrator.run(brief);
  await captureStage(brief.runId, 'complete-run', result);
  console.log(JSON.stringify({
    runId: brief.runId,
    searches: result.output.searchResult.searches,
    researchProvider: result.output.research.provider,
    relevantNotes: result.output.research.relevantCount,
    rejectedNotes: result.output.research.rejectedCount,
    curatorProvider: result.output.curation.provider,
    quality: result.output.quality,
    cards: result.output.cards.map((card) => ({ title: card.title, sourceCount: card.sources.length })),
  }, null, 2));
} finally {
  data.close();
}
