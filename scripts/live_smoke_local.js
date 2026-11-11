/** One live discovery search with exactly two keywords. Run only intentionally. */
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from '../src/config/env.js';
import { createKeywordAgent } from '../src/agents/keyword.js';
import { createDiscoveryService } from '../src/discovery.js';
import { createLocalXiaohongshuData } from '../src/data/local-xiaohongshu.js';
import { captureStage } from '../src/data/run-captures.js';

loadEnvFile();
const runId = randomUUID();
const brief = { location: '上海 · 静安', request: '想一个人安静散步，别太商业化。' };
const data = createLocalXiaohongshuData();
try {
  const plan = await createKeywordAgent().generate(brief);
  await captureStage(runId, 'keyword-plan', plan);
  const result = await createDiscoveryService({ data }).search({ keywords: plan.keywords, runId });
  let detail;
  const firstNote = result.notes.find((note) => note.id && note.xsecToken);
  if (firstNote) {
    detail = await data.getNoteDetail(firstNote.id, firstNote.xsecToken);
    await captureStage(runId, 'sample-note-detail', detail);
  }
  console.log(JSON.stringify({
    runId,
    provider: plan.provider,
    keywords: plan.keywords,
    searches: result.searches,
    uniqueNotes: result.count,
    sampleDetail: detail ? { id: detail.id, descriptionLength: detail.description?.length || 0, comments: detail.comments?.length || 0 } : null,
  }, null, 2));
} finally {
  data.close();
}
