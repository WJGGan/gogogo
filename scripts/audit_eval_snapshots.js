/** Check saved live evaluation snapshots without calling Xiaohongshu or a model. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runs = join(root, 'data', 'captures', 'runs');
const cases = JSON.parse(await readFile(join(root, 'eval', 'cases.json'), 'utf8')).main;
const batchIds = ['d329b9c7-7086-49ae-9dd6-162400546eba', '582c630b-c2e6-4e2a-8aec-8ccf35ef9851',
  '87adc9ae-07c6-47fd-9d21-380197ba1a76', 'caaf0d9b-a42a-4311-a14c-3093fee2ca36'];
async function stage(runId, name) {
  try { return JSON.parse(await readFile(join(runs, runId, `${name}.json`), 'utf8')).data; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const completed = new Map();
for (const batchId of batchIds) {
  const batch = await stage(batchId, 'batch-manifest');
  for (const item of batch?.cases || []) if (item.status === 'completed') completed.set(item.caseId, item.runId);
}
const rows = [];
for (const item of cases) {
  const runId = completed.get(item.id);
  const missing = [];
  if (!runId) { rows.push({ id: item.id, split: item.split, runId: '', missing: ['completed run'] }); continue; }
  const names = ['eval-manifest', 'keyword-plan', 'search-1', 'search-2', 'merged-search',
    'detail-plan', 'evidence-notes', 'research', 'curation', 'complete-run'];
  const values = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await stage(runId, name)])));
  for (const name of names) if (!values[name]) missing.push(name);
  const manifest = values['eval-manifest'];
  const keyword = values['keyword-plan'];
  const search = values['merged-search'];
  const detailPlan = values['detail-plan'];
  const evidence = values['evidence-notes'] || [];
  const research = values.research;
  const curation = values.curation;
  const full = values['complete-run'];
  const cards = full?.output?.cards || [];
  const byId = new Map(evidence.map((note) => [note.id, note]));
  const issues = [];
  if (manifest?.status !== 'completed') issues.push('manifest status');
  if (manifest?.caseId !== item.id) issues.push('case ID mismatch');
  if (keyword?.keywords?.length !== 2) issues.push('keyword count');
  if (search?.searches?.length !== 2 || search.searches.some((s) => !s.success)) issues.push('search failure');
  if ((detailPlan?.noteIds || []).length !== manifest?.details?.requested) issues.push('detail request mismatch');
  if (manifest?.details?.succeeded !== manifest?.details?.requested) issues.push('detail failure');
  if (manifest?.cardCount !== cards.length || curation?.cards?.length !== cards.length) issues.push('card count mismatch');
  for (const id of detailPlan?.noteIds || []) if (!byId.get(id)?.description) issues.push('selected detail lacks body');
  for (const card of cards) {
    if (!card.sources?.length) issues.push('card lacks sources');
    for (const source of card.sources || []) if (!byId.get(source.id)?.description) issues.push('card source lacks body');
  }
  let steps = 0;
  for (const [index, card] of cards.entries()) {
    const plan = await stage(runId, `direction-plan-${index + 1}`);
    if (!plan) { missing.push(`direction-plan-${index + 1}`); continue; }
    const cited = new Set((card.sources || []).map((source) => source.id));
    for (const step of plan.steps || []) {
      steps++;
      const note = byId.get(step.sourceId);
      const body = [note?.description, ...(note?.comments || []).map((comment) => comment.content)].filter(Boolean).join('\n').replace(/\s+/g, ' ');
      if (!cited.has(step.sourceId) || !body.includes(String(step.excerpt || '').replace(/\s+/g, ' '))) issues.push('invalid step citation');
    }
  }
  rows.push({ id: item.id, split: item.split, runId, missing, issues: [...new Set(issues)],
    notes: search?.count ?? 0, details: manifest?.details?.succeeded ?? 0,
    groups: research?.groups?.length ?? 0, cards: cards.length, steps,
    unmet: research?.unmetRequirements || [], researchWarning: research?.warning || '',
    curatorWarning: curation?.warning || '', anchors: cards.map((c) => c.decisionAnchor),
    quality: full?.output?.quality?.status || '' });
}
const lines = ['# 线上快照完整性核对', '',
  '仅检查已保存文件、数量和引用关系；卡片是否满足需求及来源是否在语义上支持结论，留给评分。少于三张卡不自动判错。', '',
  '| 案例 | 分组 | 笔记 | 详情 | 方向 | 卡片 | 步骤 | 文件/结构问题 |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ...rows.map((r) => `| ${r.id} | ${r.split} | ${r.notes ?? '—'} | ${r.details ?? '—'} | ${r.groups ?? '—'} | ${r.cards ?? '—'} | ${r.steps ?? '—'} | ${[...r.missing, ...(r.issues || [])].join('；') || '无'} |`),
  '', '## 少于三张卡的案例', ''];
for (const r of rows.filter((r) => r.cards < 3)) lines.push(`- ${r.id}：${r.groups} 个研究方向、${r.cards} 张卡；${r.notes} 篇搜索笔记、${r.details} 篇详情。${r.unmet.join('；') || '研究未列明确缺口'}${r.researchWarning ? `；研究告警：${r.researchWarning}` : ''}`);
lines.push('', '## 汇总', '',
  `- 完成记录：${rows.filter((r) => r.runId).length}/${cases.length}。`,
  `- 文件或结构问题案例：${rows.filter((r) => r.missing.length || r.issues?.length).length}。`,
  `- 少于三张卡：${rows.filter((r) => r.cards < 3).length}；少于两张卡：${rows.filter((r) => r.cards < 2).length}。`,
  '- “complete/partial” 是运行时卡片数量标记，不是人工质量评分。', '');
await writeFile(join(root, 'eval', '快照完整性核对.md'), lines.join('\n'), 'utf8');
await writeFile(join(root, 'eval', '快照完整性核对.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log(`完成 ${rows.filter((r) => r.runId).length}/${cases.length}；结构问题 ${rows.filter((r) => r.missing.length || r.issues?.length).length}；少于三张卡 ${rows.filter((r) => r.cards < 3).length}`);
