/** Render directly reviewed case judgments. No API calls. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = JSON.parse(await readFile(join(root, 'eval', '人工评测输入.json'), 'utf8'));
const ratings = JSON.parse(await readFile(join(root, 'eval', '人工评分-v1.json'), 'utf8'));
const byId = new Map(data.map((x) => [x.id, x]));
if (ratings.length !== data.length || new Set(ratings.map((x) => x.id)).size !== data.length)
  throw new Error('评分数量或案例 ID 不匹配');
for (const r of ratings) {
  const sample = byId.get(r.id);
  if (!sample || !['pass', 'fail'].includes(r.verdict) || r.card < 0 || r.card > sample.cards.length)
    throw new Error(`评分无效：${r.id}`);
  if (r.verdict === 'pass' && (!r.card || !sample.cards[r.card - 1].sources.some((s) => s.body)))
    throw new Error(`成功案例缺少有正文的来源：${r.id}`);
}
const lines = ['# 固定快照直接人工初评（v1）', '',
  '依据：原始线上批次的 35 条正式案例。评阅者为 Codex，逐条读取用户需求、卡片、所引笔记正文和已保存步骤；未调用评委模型 API，也未访问小红书。',
  '口径：至少一张卡满足地点与硬约束、关键行动有正文支持且可直接使用，即记任务成功。零卡和原运行模型超时记失败。重放仅用于归因，不替换原运行。',
  '这是一轮直接评阅，不是独立人类标注；`medium` 的边界判断建议用户复核。价格、营业和活动状态只按固定快照判断，不视为实时核验。', '',
  '## 汇总', '',
  '| 分组 | 成功 | 总数 | 成功率 |', '| --- | ---: | ---: | ---: |'];
for (const split of ['dev', 'validation', 'holdout']) {
  const group = ratings.filter((r) => byId.get(r.id).split === split);
  const good = group.filter((r) => r.verdict === 'pass').length;
  lines.push(`| ${split} | ${good} | ${group.length} | ${(100 * good / group.length).toFixed(1)}% |`);
}
const good = ratings.filter((r) => r.verdict === 'pass').length;
lines.push(`| **正式集** | **${good}** | **${ratings.length}** | **${(100 * good / ratings.length).toFixed(1)}%** |`, '',
  '## 逐案判断', '', '| 案例 | 结果 | 采用卡片 / 来源 | 判断依据 | 置信度 |', '| --- | --- | --- | --- | --- |');
for (const r of ratings) {
  const sample = byId.get(r.id);
  const card = r.card ? sample.cards[r.card - 1] : null;
  const source = card ? card.sources.map((s) => `\`${s.id}\``).join('、') : '—';
  const label = card ? `${card.title.replaceAll('|', '｜')}（${source}）` : '—';
  lines.push(`| ${r.id} | ${r.verdict === 'pass' ? '成功' : '失败'} | ${label} | ${r.reason.replaceAll('|', '｜')} | ${r.confidence} |`);
}
lines.push('', '## 失败归因', '');
for (const r of ratings.filter((x) => x.verdict === 'fail')) lines.push(`- **${r.id}**：${r.reason}`);
lines.push('', '## 指标边界', '',
  '- 本表给出逐案任务成功的直接评阅值。卡片数、详情数与引用原句可由 `scripts/audit_eval_snapshots.js` 复核。',
  '- 尚未逐篇判断 350 条搜索前十结果，因此不报告 Precision@10；也未逐条评分全部卡片，不报告有效卡片率和全部主张的来源支持率。',
  '- 修订需求集尚未运行，修改成功率无分母。未保存精确耗时指标，不报告 P50/P95。',
  '- 试评脚本 `scripts/score_live_eval.js` 的少量 AI 结果不纳入本报告。', '');
await writeFile(join(root, 'eval', '固定快照直接评测结果.md'), lines.join('\n'), 'utf8');
console.log(`已生成直接评阅：${good}/${ratings.length} 成功`);
