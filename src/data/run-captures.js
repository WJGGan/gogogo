import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';

const captureRoot = fileURLToPath(new URL('../../data/captures/runs/', import.meta.url));
const trialContext = new AsyncLocalStorage();

export function withTrialContext(store, userId, action) {
  if (!store) return action();
  return trialContext.run({ store, userId }, action);
}

export function claimTrialRun(runId, parentRunId = null) {
  const context = trialContext.getStore();
  if (!context) return true;
  return context.store.createRun(runId, context.userId, parentRunId);
}

export function ownsTrialRun(runId) {
  const context = trialContext.getStore();
  return !context || context.store.ownsRun(runId, context.userId);
}

export async function captureStage(runId, stage, value) {
  if (!runId || !/^[a-zA-Z0-9-]{1,80}$/.test(runId) || !/^[a-zA-Z0-9-]{1,80}$/.test(stage)) return;
  const context = trialContext.getStore();
  if (context) {
    if (!context.store.ownsRun(runId, context.userId)) throw new Error('Run ownership missing');
    context.store.saveStage(runId, stage, value);
    return;
  }
  const directory = join(captureRoot, runId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${stage}.json`), JSON.stringify({ runId, stage, savedAt: new Date().toISOString(), data: value }, null, 2), 'utf8');
}

export async function readCaptureStage(runId, stage) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(String(runId || ''))
    || !/^[a-zA-Z0-9-]{1,80}$/.test(String(stage || ''))) return null;
  const context = trialContext.getStore();
  if (context) return context.store.ownsRun(runId, context.userId) ? context.store.readStage(runId, stage) : null;
  try {
    return JSON.parse(await readFile(join(captureRoot, runId, `${stage}.json`), 'utf8')).data;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
