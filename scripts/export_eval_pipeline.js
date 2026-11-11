/** Export every original live case, stage by stage, without API calls or secrets. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runs = join(root, 'data', 'captures', 'runs');
const cases = JSON.parse(await readFile(join(root, 'eval', 'cases.json'), 'utf8')).main;
const audit = JSON.parse(await readFile(join(root, 'eval', '快照完整性核对.json'), 'utf8'));
const runByCase = new Map(audit.map((item) => [item.id, item.runId]));
async function stage(runId, name) {
  try { return JSON.parse(await readFile(join(runs, runId, `${name}.json`), 'utf8')).data; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const clean = (value, limit = 300) => String(value ?? '').replace(/\s+/g, ' ').replace(/\|/g, '｜').trim().slice(0, limit);
const code = (value) => `\`${String(value ?? '').replace(/`/g, '')}\``;
const lines = [
  '# 40 条线上评测：输入、各环节输出与最终卡片', '',
  '范围：`eval/cases.json` 的 40 条主需求，采用四个原始线上批次各案例的完成记录。此文档由已保存快照生成；重放结果不替换原运行。',
  '每条只摘录便于阅读的结构化字段，不展示 Cookie、xsecToken 或全部笔记正文。需要核对完整对象时，读取 `data/captures/runs/<runId>/<阶段名>.json` 中的 `data` 字段。',
  '“完成”仅指脚本跑完；卡片数量和步骤数不等于质量评分。搜索失败、模型告警和未满足需求会照实列出。', '',
  '## 总览', '',
  '| 案例 | 分组 | 地点 | 搜索词 | 去重笔记 | 详情成功/请求 | 方向 | 卡片 | 行程步数 |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
];
const records = [];
for (const sample of cases) {
  const runId = runByCase.get(sample.id);
  if (!runId) throw new Error(`缺少原始完成记录：${sample.id}`);
  const names = ['eval-manifest', 'keyword-plan', 'merged-search', 'detail-plan', 'evidence-notes', 'research', 'curation', 'complete-run'];
  const values = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await stage(runId, name)])));
  const cards = values['complete-run']?.output?.cards || [];
  const plans = await Promise.all(cards.map((_, i) => stage(runId, `direction-plan-${i + 1}`)));
  records.push({ sample, runId, values, cards, plans });
  const m = values['eval-manifest'];
  lines.push(`| ${sample.id} | ${sample.split} | ${clean(sample.location)} | ${values['keyword-plan']?.keywords?.length ?? 0} | ${values['merged-search']?.count ?? 0} | ${m?.details ? `${m.details.succeeded}/${m.details.requested}` : '—'} | ${values.research?.groups?.length ?? 0} | ${cards.length} | ${plans.reduce((sum, plan) => sum + (plan?.steps?.length || 0), 0)} |`);
}
lines.push('', '## 逐条记录', '');
for (const { sample, runId, values: v, cards, plans } of records) {
  const m = v['eval-manifest'];
  const keyword = v['keyword-plan'];
  const search = v['merged-search'];
  const detailPlan = v['detail-plan'];
  const evidence = v['evidence-notes'] || [];
  const research = v.research;
  const curation = v.curation;
  const byId = new Map(evidence.map((note) => [note.id, note]));
  lines.push(`### ${sample.id} · ${sample.split}`, '',
    `- **输入**：${clean(sample.location)}；${clean(sample.request, 500)}`,
    `- **运行**：${code(runId)}；脚本状态 ${m?.status || '未知'}。`,
    `- **关键词 Agent 输出**（${keyword?.provider || '未知'}）：${(keyword?.keywords || []).map((x) => `「${clean(x, 80)}」`).join('、') || '无'}；需求特征 ${keyword?.facets?.map(code).join('、') || '无'}；推荐粒度 ${keyword?.recommendationScope || '未知'}。${keyword?.warning ? `告警：${clean(keyword.warning, 120)}。` : ''}`,
    `- **搜索输出**：${(search?.searches || []).map((s) => `「${clean(s.keyword, 80)}」${s.success ? `${s.count} 篇` : `失败：${clean(s.error?.code)}`}`).join('；') || '无'}；合并去重 ${search?.count ?? 0} 篇。`);
  lines.push(`- **搜索笔记前 10 篇**：${(search?.notes || []).slice(0, 10).map((note) => `${code(note.id)} ${clean(note.title || '无标题', 55)}`).join('；') || '无'}。`);
  lines.push(`- **详情选择输出**（${detailPlan?.provider || '未知'}）：选 ${detailPlan?.noteIds?.length ?? 0} 篇；${m?.details ? `${m.details.succeeded}/${m.details.requested}` : '—'} 读取成功。${detailPlan?.warning ? `告警：${clean(detailPlan.warning, 120)}。` : ''}`);
  for (const id of detailPlan?.noteIds || []) {
    const note = byId.get(id);
    lines.push(`  - ${code(id)} ${clean(note?.title || '无标题', 90)}；正文 ${note?.description?.length || 0} 字；评论 ${note?.comments?.length || 0} 条。正文摘录：${clean(note?.description, 260) || '无'}。${note?.comments?.length ? `评论摘录：${clean(note.comments[0]?.content, 100)}。` : ''}`);
  }
  lines.push(`- **Researcher 输出**（${research?.provider || '未知'}）：${research?.groups?.length ?? 0} 个方向；使用 ${research?.relevantCount ?? 0} 篇笔记。${research?.warning ? `告警：${clean(research.warning, 140)}。` : ''}${research?.unmetRequirements?.length ? `未满足：${research.unmetRequirements.map((x) => clean(x, 120)).join('；')}。` : ''}`);
  for (const group of research?.groups || []) {
    lines.push(`  - ${code(group.key)} ${clean(group.theme, 70)}；${group.decisionType}：${clean(group.decisionAnchor, 90)}；行动：${clean(group.action, 100)}；依据 ${group.noteIds.map(code).join('、')}。理由：${clean(group.reason, 180) || '无'}；证据摘要：${clean(group.summary, 220) || '无'}。`);
  }
  lines.push(`- **Curator 输出**（${curation?.provider || '未知'}）：${curation?.cards?.length ?? 0} 张卡。${curation?.warning ? `告警：${clean(curation.warning, 140)}。` : ''}`);
  if (!cards.length) lines.push('  - 无最终卡片。');
  for (const [i, card] of cards.entries()) {
    const plan = plans[i];
    lines.push(`  ${i + 1}. **${clean(card.title, 110)}**；玩法：${clean(card.angle, 60)}；行动：${clean(card.action, 150)}。`,
      `     - 推荐理由：${clean(card.whyThis, 200) || '未提供'}；证据摘要：${clean(card.evidenceSummary, 220) || '未提供'}。`,
      `     - 来源：${(card.sources || []).map((s) => `${code(s.id)} ${clean(s.title, 70)}`).join('、') || '无'}。${card.caveat ? `注意：${clean(card.caveat, 160)}。` : ''}`,
      `     - **Direction Planner 输出**（${plan?.provider || '无'}）：${plan?.steps?.length ?? 0} 步。${plan?.limitation ? `限制：${clean(plan.limitation, 180)}。` : ''}`);
    for (const step of plan?.steps || []) lines.push(`       - ${clean(step.place, 70)}：${clean(step.action, 130)}；来源 ${code(step.sourceId)}；原句「${clean(step.excerpt, 130)}」。`);
  }
  lines.push(`- **最终质量标记**：${v['complete-run']?.output?.quality?.status || '未知'}（程序运行标记，不是人工评分）。`, '');
}
const output = join(root, 'eval', '40条评测全链路输出.md');
await writeFile(output, lines.join('\n'), 'utf8');
console.log(`已写入 ${output}：${records.length} 条，${lines.length} 行`);
