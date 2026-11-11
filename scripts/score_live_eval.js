/** AI first pass over the original fixed live runs. Does not fetch Xiaohongshu. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../src/config/env.js';
import { createJsonModel } from '../src/agents/model-json.js';

loadEnvFile();
const root = fileURLToPath(new URL('../', import.meta.url));
const runDir = join(root, 'data', 'captures', 'runs');
const scoreDir = join(root, 'eval', 'scores-ai-v1');
const cases = JSON.parse(await readFile(join(root, 'eval', 'cases.json'), 'utf8')).main.filter((c) => c.split !== 'pilot');
const batchIds = ['582c630b-c2e6-4e2a-8aec-8ccf35ef9851', '87adc9ae-07c6-47fd-9d21-380197ba1a76', 'caaf0d9b-a42a-4311-a14c-3093fee2ca36'];
const args = process.argv.slice(2);
const onlyCase = args.includes('--case') ? args[args.indexOf('--case') + 1] : '';
const max = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : Infinity;
if ((onlyCase && !cases.some((c) => c.id === onlyCase)) || !Number.isInteger(max) && max !== Infinity || max < 1)
  throw new Error('Usage: node scripts/score_live_eval.js [--case BJ07] [--max 3]');
const modelName = process.env.JUDGE_MODEL_NAME || 'deepseek-flash';
const judge = createJsonModel({ model: modelName });
if (!judge.configured) throw new Error('未配置模型 API');
async function stage(id, name) {
  try { return JSON.parse(await readFile(join(runDir, id, `${name}.json`), 'utf8')).data; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
const runIds = new Map();
for (const id of batchIds) {
  const batch = await stage(id, 'batch-manifest');
  for (const c of batch.cases) if (c.status === 'completed') runIds.set(c.caseId, c.runId);
}
await mkdir(scoreDir, { recursive: true });
const prompt = '你是独立评测员。仅根据用户需求、原笔记和卡片判断，不相信卡片自己的解释。每张卡给 matches_request、grounded、distinct 三个 0/1；行程给 actionable、grounded 两个 0/1。必须遵守明确限制；原文提到词语但不支持结论时 grounded=0。只给有依据的短理由和来源 ID；不确定时给 0 并说明。1 张有效卡也可成功，0 卡为失败。返回 JSON：{"cards":[{"id":"...","matches_request":0,"grounded":0,"distinct":0,"reason":"...","sourceIds":["..."]}],"plans":[{"cardId":"...","actionable":0,"grounded":0,"reason":"..."}],"severeError":false,"caseReason":"...","confidence":"high|medium|low"}。';
let done = 0;
for (const sample of cases) {
  if (onlyCase && sample.id !== onlyCase) continue;
  if (done >= max) break;
  const path = join(scoreDir, `${sample.id}.json`);
  try { await readFile(path, 'utf8'); console.log(`${sample.id}: 已有评分，跳过`); continue; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const runId = runIds.get(sample.id);
  if (!runId) throw new Error(`找不到 ${sample.id} 的成功运行`);
  const full = await stage(runId, 'complete-run');
  const notes = await stage(runId, 'evidence-notes') || [];
  const cards = full?.output?.cards || [];
  const byId = new Map(notes.map((n) => [n.id, n]));
  const plans = await Promise.all(cards.map((_, i) => stage(runId, `direction-plan-${i + 1}`)));
  const payload = {
    request: { location: sample.location, text: sample.request },
    cards: cards.map((c, i) => ({ id: c.id, title: c.title, hook: c.hook, action: c.action,
      whyThis: c.whyThis, caveat: c.caveat, plan: (plans[i]?.steps || []).map((s) => ({ place: s.place, action: s.action, sourceId: s.sourceId, excerpt: s.excerpt })),
      sources: (c.sources || []).map((s) => { const n = byId.get(s.id); return { id: s.id, title: n?.title || s.title,
        description: (n?.description || '').slice(0, 1200), comments: (n?.comments || []).slice(0, 2).map((x) => x.content) }; }) })),
  };
  let result;
  if (!cards.length) result = { cards: [], plans: [], severeError: false, caseReason: '原始线上运行未产出卡片', confidence: 'high' };
  else result = await judge.complete(prompt, payload);
  const validIds = new Set(cards.map((c) => c.id));
  const scored = Array.isArray(result.cards) ? result.cards.filter((c) => validIds.has(c.id)) : [];
  const planScores = Array.isArray(result.plans) ? result.plans.filter((p) => validIds.has(p.cardId)) : [];
  const validCards = scored.filter((c) => c.matches_request === 1 && c.grounded === 1 && c.distinct === 1);
  const candidateSuccess = validCards.some((c) => {
    const card = cards.find((x) => x.id === c.id);
    const p = planScores.find((x) => x.cardId === c.id);
    return (p?.actionable === 1 && p?.grounded === 1) || Boolean(card?.action && c.grounded === 1);
  }) && !result.severeError;
  const output = { caseId: sample.id, split: sample.split, runId, judgeModel: cards.length ? modelName : 'deterministic-zero-card',
    promptVersion: 'v1', scoredAt: new Date().toISOString(), candidateSuccess, needsHumanReview: true,
    score: { ...result, cards: scored, plans: planScores } };
  await writeFile(path, JSON.stringify(output, null, 2), 'utf8');
  console.log(`${sample.id}: ${cards.length} 卡，AI 候选${candidateSuccess ? '成功' : '失败'}`);
  done++;
}
