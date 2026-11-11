// Reads frozen evidence only. Model API calls are allowed; no XHS connector is imported.
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../src/config/env.js';
import { readCaptureStage } from '../src/data/run-captures.js';
import { createResearcherAgent } from '../src/agents/researcher.js';
import { createCuratorAgent } from '../src/agents/curator.js';
import { createDirectionPlanner } from '../src/agents/direction-planner.js';

loadEnvFile();
const replayId = randomUUID();
const directory = fileURLToPath(new URL(`../data/captures/replays/${replayId}/`, import.meta.url));
await mkdir(directory, { recursive: true });
const lines = ['# 正文与需求匹配修复：固定数据回放', '',
  '使用之前的原始输入和笔记快照，重新调用模型研究、成卡和细化；未访问小红书。两个案例用于回归检查，不能代表整体效果。', '',
  '| 案例 | 原卡片 / 有步骤卡片 | 新卡片 / 有步骤卡片 | 所有卡片引用均有正文 |',
  '| --- | ---: | ---: | --- |'];
const sections = [];
for (const [caseId, sourceRunId] of [
  ['BJ03', '21727f52-d9f1-436e-8bd2-3507c546ebdc'],
  ['BJ04', '0b437883-3f64-4b24-81bb-3d9b30d44433'],
]) {
  console.log(`${caseId}：回放已存证据`);
  const source = await readCaptureStage(sourceRunId, 'complete-run');
  const before = await readCaptureStage(sourceRunId, 'eval-manifest');
  const notes = await readCaptureStage(sourceRunId, 'evidence-notes');
  const brief = source.output.keywordPlan.brief;
  const research = await createResearcherAgent().analyze({ brief, notes });
  console.log(`${caseId}：研究方向 ${research.groups.length}，${research.provider}`);
  const curation = await createCuratorAgent().compose({ brief, groups: research.groups, notes });
  const plans = [];
  for (const card of curation.cards) plans.push(await createDirectionPlanner().plan({ brief, card, notes }));
  const allDetailed = curation.cards.every((card) => card.sources.every((s) => notes.find((n) => n.id === s.id)?.description?.trim()));
  const result = { replayId, caseId, sourceRunId, version: 'body-only-research-v1',
    model: process.env.ANALYSIS_MODEL_NAME || process.env.AGENT_MODEL_NAME || process.env.MODEL_NAME,
    input: brief, research, curation, plans, allDetailed };
  await writeFile(`${directory}/${caseId}.json`, JSON.stringify(result, null, 2));
  lines.push(`| ${caseId} | ${before.cardCount} / ${before.plans.filter((p) => p.steps > 0).length} | ${curation.cards.length} / ${plans.filter((p) => p.steps.length > 0).length} | ${curation.cards.length ? allDetailed : '无卡片'} |`);
  sections.push('', `## ${caseId}`, '', `需求：${brief.location}；${brief.request}`, '',
    `原运行：\`${sourceRunId}\`；回放：\`${replayId}\`。`, '',
    `原卡片：${source.output.cards.map((c) => c.title).join('；')}`, '');
  if (research.warning) sections.push(`研究警告：${research.warning}`, '');
  for (const [index, card] of curation.cards.entries()) {
    sections.push(`- **${card.title}**：${card.action}；来源 ${card.sources.length} 篇，步骤 ${plans[index].steps.length} 条。`);
    for (const step of plans[index].steps) sections.push(`  - ${step.place}：${step.action}。依据：${step.excerpt}`);
    if (plans[index].limitation) sections.push(`  - 限制：${plans[index].limitation}`);
  }
  console.log(`${caseId}：完成，${curation.cards.length} 张卡，${plans.filter((p) => p.steps.length > 0).length} 张有步骤`);
}
await writeFile(new URL('../eval/修复回放.md', import.meta.url), [...lines, ...sections].join('\n'));
console.log('报告：eval/修复回放.md');
