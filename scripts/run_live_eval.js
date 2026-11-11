/** Run exactly one evaluation case against the live, read-only connector. */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../src/config/env.js';
import { createLocalXiaohongshuData } from '../src/data/local-xiaohongshu.js';
import { createDiscoveryService } from '../src/discovery.js';
import { createKeywordAgent } from '../src/agents/keyword.js';
import { createDiscoveryOrchestrator } from '../src/agents/discovery-orchestrator.js';
import { createDirectionPlanner } from '../src/agents/direction-planner.js';
import { captureStage, readCaptureStage } from '../src/data/run-captures.js';

loadEnvFile();
const args = process.argv.slice(2);
const caseId = args[args.indexOf('--case') + 1];
if (!args.includes('--live') || !/^([A-Z]{2}\d{2})$/.test(caseId || '')) {
  console.error('用法: node scripts/run_live_eval.js --case SH01 --live');
  process.exit(2);
}
const cases = JSON.parse(await readFile(new URL('../eval/cases.json', import.meta.url), 'utf8'));
const sample = cases.main.find((item) => item.id === caseId);
if (!sample) throw new Error(`找不到评测案例 ${caseId}`);
const runId = randomUUID();
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const data = createLocalXiaohongshuData({ cacheDir: join(projectRoot, 'data', 'captures', 'live-cache', runId) });
const startedAt = new Date().toISOString();
const manifest = { caseId, runId, split: sample.split, input: { location: sample.location, request: sample.request },
  startedAt, mode: 'live-fresh', status: 'running' };
await captureStage(runId, 'eval-manifest', manifest);
try {
  const logged = await data.loginStatus();
  if (!logged.isLoggedIn) throw new Error('当前会话未登录；先运行 python xhs_connector.py login --fresh');
  const discovery = createDiscoveryService({ data, failFast: true });
  const result = await createDiscoveryOrchestrator({ keywordAgent: createKeywordAgent(), discovery })
    .run({ ...manifest.input, runId });
  await captureStage(runId, 'complete-run', result);
  const evidence = (await readCaptureStage(runId, 'evidence-notes')) || [];
  const planner = createDirectionPlanner();
  const plans = [];
  for (const [index, card] of result.output.cards.entries()) {
    const plan = await planner.plan({ brief: result.output.keywordPlan.brief, card, notes: evidence });
    await captureStage(runId, `direction-plan-${index + 1}`, plan);
    plans.push({ cardId: card.id, steps: plan.steps.length, provider: plan.provider });
  }
  const completed = { ...manifest, status: 'completed', finishedAt: new Date().toISOString(),
    searches: result.output.searchResult.searches.map(({ keyword, success, count, error }) => ({ keyword, success, count, error })),
    uniqueNotes: result.output.searchResult.count, details: result.output.detailResult,
    cardCount: result.output.cards.length, plans };
  await captureStage(runId, 'eval-manifest', completed);
  console.log(JSON.stringify(completed, null, 2));
} catch (error) {
  const failed = { ...manifest, status: 'failed', finishedAt: new Date().toISOString(),
    error: { code: error.code || 'EVAL_RUN_FAILED', message: error.message } };
  await captureStage(runId, 'eval-manifest', failed);
  console.error(JSON.stringify(failed, null, 2));
  process.exitCode = 1;
} finally {
  data.close();
}
