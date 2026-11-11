/** Summarize saved evaluation runs without exposing cookies or xsec tokens. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runsDir = join(root, 'data', 'captures', 'runs');
const output = join(root, 'eval', '运行回顾.md');
const cases = JSON.parse(await readFile(join(root, 'eval', 'cases.json'), 'utf8'));
const caseOrder = new Map(cases.main.map((item, index) => [item.id, index]));
const clean = (value, limit = 240) => String(value ?? '').replace(/\s+/g, ' ').replace(/[|]/g, '｜').slice(0, limit);
async function stage(id, name) {
  try { return JSON.parse(await readFile(join(runsDir, id, `${name}.json`), 'utf8')).data; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

const entries = [];
for (const id of await readdir(runsDir)) {
  const manifest = await stage(id, 'eval-manifest');
  if (manifest?.caseId) entries.push({ id, manifest });
}
entries.sort((a, b) => (caseOrder.get(a.manifest.caseId) ?? 999) - (caseOrder.get(b.manifest.caseId) ?? 999));
const done = entries.filter((entry) => entry.manifest.status === 'completed');
const completedCases = new Set(done.map((entry) => entry.manifest.caseId));
const displayStatus = (entry) => entry.manifest.status === 'running' && completedCases.has(entry.manifest.caseId)
  ? '已中断，后有完整重跑' : entry.manifest.status;
const lines = [
  '# 已采集案例运行回顾', '',
  `生成时间：${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date())}（北京时间）。数据来自本机固定快照；这是**过程回顾**，不是人工质量评分。`,
  '文档不写入 Cookie、xsecToken、原始评论全文。每条的完整阶段快照在 `data/captures/runs/<runId>/`；原始网页返回在 `data/captures/live-cache/<runId>/`。', '',
  '## 总览', '',
  '| 案例 | 版本 | 搜索成功/计划 | 去重笔记 | 详情成功/请求 | 卡片 | 有步骤卡片 | 状态 |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
];
for (const { id, manifest: m } of entries) {
  const keyword = await stage(id, 'keyword-plan');
  const version = keyword?.run?.version || '未知';
  const searches = m.searches || [];
  lines.push(`| ${m.caseId} | Planner ${version} | ${searches.filter((item) => item.success).length}/${keyword?.keywords?.length ?? '—'} | ${m.uniqueNotes ?? '—'} | ${m.details ? `${m.details.succeeded}/${m.details.requested}` : '—'} | ${m.cardCount ?? '—'} | ${m.plans?.filter((item) => item.steps > 0).length ?? '—'} | ${displayStatus({ manifest: m })} |`);
}
lines.push('', '说明：卡片数量与有步骤卡片数量只反映程序产出；需求匹配、来源真实性和任务成功仍需按评分口径人工裁决。', '',
  '### 本次简要观察', '',
  '- Planner 0.5.0 的 3 条新案例（BJ02、BJ03、BJ04）都生成 2 个搜索词，搜索和 6 篇详情均成功；共 8 张卡，其中 3 张能细化出步骤。',
  '- SH08 使用 Planner 0.4.0，两个词只是词序互换；因此又加入了重写检查。SH08 不计入 0.5.0 的观察。',
  '- 需人工复核：BJ03 的一张卡指向海淀，而需求地点是西城；BJ04 雨天室内需求出现 citywalk 卡。',
  '- 新旧案例的需求不同，以上只说明流程现象，不能据此认定提示词质量提升或下降；需用同一快照重跑对照。', '');

for (const { id, manifest: m } of entries) {
  lines.push(`## ${m.caseId} · ${displayStatus({ manifest: m })}`, '');
  lines.push(`- 输入：${clean(m.input?.location)}；${clean(m.input?.request, 500)}`);
  lines.push(`- 运行 ID：\`${id}\``);
  if (m.status !== 'completed') {
    lines.push(`- 错误：${clean(m.error?.message || '未完成', 300)}`, '');
    continue;
  }
  const keyword = await stage(id, 'keyword-plan');
  const search = await stage(id, 'merged-search');
  const detailPlan = await stage(id, 'detail-plan');
  const evidence = await stage(id, 'evidence-notes') || [];
  const research = await stage(id, 'research');
  const curation = await stage(id, 'curation');
  const completed = await stage(id, 'complete-run');
  const byId = new Map(evidence.map((note) => [note.id, note]));
  lines.push(`- 关键词（${keyword?.provider || '未知'} / ${keyword?.model || '未记录'}）：${(keyword?.keywords || []).map((item) => `「${clean(item)}」`).join('、') || '无'}`);
  lines.push(`- 搜索：${(search?.searches || m.searches || []).map((item) => `${clean(item.keyword)} ${item.success ? `${item.count} 条` : `失败 ${clean(item.error?.code)}`}`).join('；') || '无'}；去重后 ${search?.count ?? m.uniqueNotes ?? 0} 条。`);
  const selected = (detailPlan?.noteIds || []).map((noteId) => byId.get(noteId)).filter(Boolean);
  lines.push(`- 详情选读（${detailPlan?.provider || '未知'}）：${m.details?.succeeded ?? 0}/${m.details?.requested ?? 0} 成功。${selected.map((note) => `「${clean(note.title, 55)}」`).join('、') || '无'}`);
  lines.push(`- 研究（${research?.provider || '未知'}）：${research?.relevantCount ?? '—'} 条被判相关，形成 ${research?.groups?.length ?? 0} 个方向。${research?.warning ? `警告：${clean(research.warning, 100)}。` : ''}`);
  for (const group of research?.groups || []) {
    lines.push(`  - ${clean(group.theme, 35)}：${clean(group.decisionAnchor, 60)}；行动：${clean(group.action, 80)}；来源 ${group.noteIds?.length || 0} 篇；证据级别 ${group.evidenceLevel || '未记录'}。`);
  }
  lines.push(`- 卡片（${curation?.provider || '未知'}）：${curation?.cards?.length ?? 0} 张；运行质量标记 ${completed?.output?.quality?.status || '未知'}。`);
  for (const [index, card] of (curation?.cards || []).entries()) {
    const plan = await stage(id, `direction-plan-${index + 1}`);
    const sourceBodies = (card.sources || []).filter((source) => byId.get(source.id)?.description).length;
    lines.push(`  ${index + 1}. **${clean(card.title, 80)}**：${clean(card.hook, 130)}。匹配理由：${clean(card.whyThis, 150)}。来源 ${card.sources?.length || 0} 篇，其中 ${sourceBodies} 篇有已存正文；行程 ${plan?.steps?.length || 0} 步。`);
    for (const step of plan?.steps || []) {
      lines.push(`     - ${clean(step.place, 50)}：${clean(step.action, 100)}；依据「${clean(step.excerpt, 80)}」`);
    }
    if (!plan?.steps?.length && plan?.limitation) lines.push(`     - 细化限制：${clean(plan.limitation, 150)}`);
  }
  lines.push('');
}
await writeFile(output, lines.join('\n'), 'utf8');
console.log(`已写入 ${output}：${done.length} 条完成，${entries.length - done.length} 条未完成`);
