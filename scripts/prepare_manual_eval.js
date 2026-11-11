/** Prepare compact, source-backed review inputs from original live runs; no API calls. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runs = join(root, 'data', 'captures', 'runs');
const cases = JSON.parse(await readFile(join(root, 'eval', 'cases.json'), 'utf8')).main.filter((x) => x.split !== 'pilot');
const audit = JSON.parse(await readFile(join(root, 'eval', '快照完整性核对.json'), 'utf8'));
const byCase = new Map(audit.map((x) => [x.id, x]));
async function stage(id, name) {
  try { return JSON.parse(await readFile(join(runs, id, `${name}.json`), 'utf8')).data; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
const output = [];
for (const item of cases) {
  const runId = byCase.get(item.id)?.runId;
  const [search, notes, full] = await Promise.all(['merged-search', 'evidence-notes', 'complete-run'].map((name) => stage(runId, name)));
  const cards = full?.output?.cards || [];
  const byId = new Map((notes || []).map((note) => [note.id, note]));
  const plans = await Promise.all(cards.map((_, i) => stage(runId, `direction-plan-${i + 1}`)));
  output.push({ id: item.id, split: item.split, runId, location: item.location, request: item.request,
    searchTop10: (search?.notes || []).slice(0, 10).map((note) => ({ id: note.id, title: note.title,
      description: (byId.get(note.id)?.description || '').slice(0, 500) })),
    cards: cards.map((card, i) => ({ id: card.id, title: card.title, hook: card.hook, whyThis: card.whyThis,
      action: card.action, caveat: card.caveat, decisionType: card.decisionType,
      sources: (card.sources || []).map((source) => { const note = byId.get(source.id); return {
        id: source.id, title: note?.title || source.title, body: (note?.description || '').slice(0, 1600),
        comments: (note?.comments || []).slice(0, 3).map((x) => x.content) }; }),
      steps: (plans[i]?.steps || []).map((s) => ({ place: s.place, action: s.action, sourceId: s.sourceId, excerpt: s.excerpt })),
      planLimitation: plans[i]?.limitation || '' })),
    structural: byCase.get(item.id) });
}
await writeFile(join(root, 'eval', '人工评测输入.json'), JSON.stringify(output, null, 2), 'utf8');
console.log(`已准备 ${output.length} 条正式案例；无模型 API 调用`);
