/** Sequential live collection. Stops on the first failed case. */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../src/config/env.js';
import { captureStage, readCaptureStage } from '../src/data/run-captures.js';

loadEnvFile();
const args = process.argv.slice(2);
const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const split = value('--split') || 'pilot';
const resumeId = value('--resume');
const validSplits = new Set(['pilot', 'dev', 'validation', 'holdout']);
const maxCases = value('--max') === undefined ? Infinity : Number(value('--max'));
let betweenMs = value('--between-ms') === undefined ? 60000 : Number(value('--between-ms'));
if ((!args.includes('--live') && !args.includes('--dry-run')) || !validSplits.has(split)
  || !Number.isInteger(maxCases) && maxCases !== Infinity || maxCases < 1
  || !Number.isInteger(betweenMs) || betweenMs < 0
  || (resumeId && !/^[a-zA-Z0-9-]{1,80}$/.test(resumeId))) {
  console.error('用法: node scripts/run_live_eval_batch.js --split pilot --live [--max 5] [--between-ms 60000] [--resume 批次ID]');
  process.exit(2);
}

const cases = JSON.parse(await readFile(new URL('../eval/cases.json', import.meta.url), 'utf8'));
const selected = cases.main.filter((item) => item.split === split);
if (args.includes('--dry-run')) {
  console.log(JSON.stringify({ split, count: selected.length, caseIds: selected.map((item) => item.id) }, null, 2));
  process.exit(0);
}
const batchId = resumeId || randomUUID();
let manifest = resumeId ? await readCaptureStage(batchId, 'batch-manifest') : null;
if (resumeId && (!manifest || manifest.split !== split)) throw new Error('找不到匹配分组的批次记录');
if (resumeId && !args.includes('--between-ms')) betweenMs = manifest.betweenMs;
if (resumeId && manifest.cases.at(-1)?.status === 'failed') {
  if (!args.includes('--retry-failed')) {
    throw new Error('上一条失败；确认原因已处理后，加 --retry-failed 重新运行该案例');
  }
  manifest.cases.pop();
}
if (!manifest) manifest = { batchId, split, startedAt: new Date().toISOString(),
  minIntervalMs: process.env.XHS_MIN_INTERVAL_MS || '8000', betweenMs, cases: [] };
if (resumeId && manifest.betweenMs !== betweenMs && args.includes('--between-ms')) {
  throw new Error('续跑时案例间隔须与原批次一致');
}

async function runOne(caseId) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./run_live_eval.js', import.meta.url)),
      '--case', caseId, '--live'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ status: 'failed', error: error.message }));
    child.on('close', (code) => {
      const raw = code === 0 ? stdout : stderr;
      let result;
      try { result = JSON.parse(raw); } catch { /* keep a short diagnostic below */ }
      resolve({ status: code === 0 ? 'completed' : 'failed',
        runId: result?.runId, notes: result?.uniqueNotes, cards: result?.cardCount,
        error: result?.error?.message || (code === 0 ? undefined : raw.slice(0, 1200)) });
    });
  });
}

console.log(`批次 ${batchId}：${split}，目标 ${selected.length} 条；两条之间至少 ${betweenMs / 1000} 秒。`);
let attempted = 0;
for (const sample of selected) {
  if (manifest.cases.some((item) => item.caseId === sample.id)) continue;
  if (attempted >= maxCases) break;
  if (manifest.cases.length) await new Promise((resolve) => setTimeout(resolve, betweenMs));
  console.log(`运行 ${sample.id}...`);
  const outcome = await runOne(sample.id);
  manifest.cases.push({ caseId: sample.id, at: new Date().toISOString(), ...outcome });
  manifest.updatedAt = new Date().toISOString();
  await captureStage(batchId, 'batch-manifest', manifest);
  console.log(`${sample.id}: ${outcome.status}，runId=${outcome.runId || '无'}，笔记=${outcome.notes ?? '无'}，卡片=${outcome.cards ?? '无'}`);
  attempted += 1;
  if (outcome.status !== 'completed') {
    console.error(`已在首个失败处停止：${outcome.error || '未知错误'}`);
    process.exitCode = 1;
    break;
  }
}
console.log(`批次记录：data/captures/runs/${batchId}/batch-manifest.json`);
