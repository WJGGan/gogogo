import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvFile } from './config/env.js';
import { DataError } from './data/xiaohongshu.js';
import { createLocalXiaohongshuData } from './data/local-xiaohongshu.js';
import { captureStage, readCaptureStage, withTrialContext, claimTrialRun, ownsTrialRun } from './data/run-captures.js';
import { createTrialStore } from './data/trial-store.js';
import { createKeywordAgent, getKeywordAgentConfig } from './agents/keyword.js';
import { createDiscoveryOrchestrator } from './agents/discovery-orchestrator.js';
import { createDirectionPlanner } from './agents/direction-planner.js';
import { createRevisionService } from './agents/revision.js';
import { withModelCredential } from './agents/model-credential.js';
import { validateOwnModel } from './config/own-model.js';
import { createDiscoveryService } from './discovery.js';

loadEnvFile();

const data = createLocalXiaohongshuData();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 3001;
const webRoot = resolve(fileURLToPath(new URL('../web/', import.meta.url)));
const staticTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

async function serveWeb(req, res, path) {
  const requested = path === '/' ? '/index.html' : path;
  if (requested.split('/').some((part) => part.startsWith('.'))) return false;
  const file = resolve(webRoot, `.${requested}`);
  const type = staticTypes[extname(file)];
  if (!file.startsWith(webRoot + sep) || !type) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 65536) throw new DataError('INVALID_INPUT', '请求体过大', 413);
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new DataError('INVALID_INPUT', '请求体不是有效 JSON', 400);
  }
}

export function createDataServer(provider = data, options = {}) {
  const trialStore = options.trialStore || null;
  const inviteCodes = options.inviteCodes || [];
  const discoveryJobs = new Map();
  const planJobs = new Map();
  const keywordAgent = options.keywordAgent || createKeywordAgent();
  const discovery = options.discovery || createDiscoveryService({ data: provider });
  const orchestrator = options.orchestrator || createDiscoveryOrchestrator({
    keywordAgent, discovery, researcher: options.researcher, curator: options.curator,
  });
  const directionPlanner = options.directionPlanner || createDirectionPlanner();
  const revision = options.revision || createRevisionService({ keywordAgent, discovery, orchestrator,
    researcher: options.researcher, curator: options.curator, directionPlanner,
    supplementalQueryPlanner: options.supplementalQueryPlanner });
  async function directionPlanSource(runId, cardId) {
    if (!ownsTrialRun(runId)) throw new DataError('PLAN_SOURCE_NOT_FOUND', '找不到这次运行保存的方向和笔记', 404);
    const completed = await readCaptureStage(runId, 'complete-run');
    const notes = await readCaptureStage(runId, 'evidence-notes');
    const cards = completed?.output?.cards || [];
    const index = cards.findIndex((card) => card.id === cardId);
    if (index < 0 || !Array.isArray(notes))
      throw new DataError('PLAN_SOURCE_NOT_FOUND', '找不到这次运行保存的方向和笔记', 404);
    return { stage: `direction-plan-${index + 1}`,
      brief: { ...completed.output.keywordPlan?.brief, facets: completed.output.keywordPlan?.facets || [] },
      card: cards[index], notes };
  }
  return createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    try {
      if ((req.method === 'GET' || req.method === 'HEAD') && !path.startsWith('/api/') && await serveWeb(req, res, path)) return;
      if (trialStore && req.method === 'POST' && path === '/api/auth/redeem') {
        const { code } = await readJson(req);
        const session = trialStore.redeem(code, inviteCodes);
        if (!session) throw new DataError('INVALID_INVITE', '邀请码无效', 401);
        return send(res, 200, { success: true, data: session });
      }
      if (trialStore && req.method === 'POST' && path === '/api/auth/own') {
        validateOwnModel(await readJson(req));
        return send(res, 200, { success: true, data: trialStore.createOwnSession() });
      }
      const session = trialStore?.session(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      const userId = session?.userId;
      if (trialStore && !userId && path !== '/api/data/health')
        throw new DataError('UNAUTHORIZED', '请先选择使用方式', 401);
      const credential = session?.mode === 'own'
        ? validateOwnModel({ apiKey: req.headers['x-model-api-key'], apiUrl: req.headers['x-model-api-url'],
          model: req.headers['x-model-name'] }) : null;
      return await withModelCredential(credential, () => withTrialContext(trialStore, userId, async () => {
      let result;
      if (req.method === 'OPTIONS') return send(res, 204, null);
      if (req.method === 'GET' && path === '/api/data/health') {
        return send(res, 200, { success: true, data: { status: 'ok' } });
      }
      if (req.method === 'GET' && path === '/api/auth/status') {
        return send(res, 200, { success: true, data: { mode: session?.mode || 'development',
          configured: session?.mode === 'own' ? true : getKeywordAgentConfig().configured } });
      }
      if (req.method === 'GET' && path === '/api/config/model') {
        return send(res, 200, { success: true, data: getKeywordAgentConfig() });
      }
      if (req.method === 'GET' && path === '/api/data/login/status') {
        result = await provider.loginStatus();
      } else if (req.method === 'GET' && path === '/api/data/login/qrcode') {
        result = await provider.loginQrCode();
      } else if (req.method === 'POST' && path === '/api/data/notes/search') {
        const body = await readJson(req);
        result = await provider.searchNotes(body.keyword, body.filters);
      } else if (req.method === 'POST' && path === '/api/data/notes/detail') {
        const body = await readJson(req);
        result = await provider.getNoteDetail(body.id, body.xsecToken, body.options);
      } else if (req.method === 'POST' && path === '/api/discovery/keywords') {
        const body = await readJson(req);
        if (trialStore && (!body.runId || !claimTrialRun(body.runId)))
          throw new DataError('RUN_CONFLICT', '运行编号无效或已被使用', 409);
        result = await keywordAgent.generate(body);
        await captureStage(body.runId, 'keyword-plan', result);
      } else if (req.method === 'POST' && path === '/api/discovery/search') {
        result = await discovery.search(await readJson(req));
      } else if (req.method === 'POST' && path === '/api/discovery/start') {
        const body = await readJson(req);
        const runId = body.runId;
        if (typeof runId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(runId))
          throw new DataError('INVALID_INPUT', '运行编号无效', 400);
        if (discoveryJobs.has(runId) || await readCaptureStage(runId, 'complete-run'))
          throw new DataError('RUN_CONFLICT', '这次运行已经开始', 409);
        if (!claimTrialRun(runId)) throw new DataError('RUN_CONFLICT', '运行编号已被使用', 409);
        const job = { userId, state: 'running', stage: 'keywords', completedStages: [],
          progress: { phase: 'keywords', percent: 4, message: '已接收需求，准备生成检索词' },
          updates: [], error: null };
        discoveryJobs.set(runId, job);
        void Promise.resolve().then(async () => {
          try {
            const completed = await orchestrator.run(body, { emit(event) {
              if (event.type === 'stage.started') job.stage = event.stage;
              if (event.type === 'stage.completed') job.completedStages.push(event.stage);
              if (event.type === 'progress') {
                job.progress = { phase: event.phase, percent: event.percent, message: event.message };
                job.updates.push({ percent: event.percent, message: event.message });
                if (job.updates.length > 8) job.updates.shift();
              }
            } });
            await captureStage(runId, 'complete-run', completed);
            job.state = 'done';
          } catch (error) {
            console.error('Discovery job failed:', runId, error);
            job.state = 'failed';
            job.error = error instanceof DataError
              ? { code: error.code, message: error.message }
              : { code: 'RUN_FAILED', message: '这次搜索未能完成，请重试' };
          } finally {
            setTimeout(() => discoveryJobs.delete(runId), 30 * 60 * 1000).unref();
          }
        });
        return send(res, 202, { success: true, data: { runId, state: 'running' } });
      } else if (req.method === 'GET' && path === '/api/discovery/status') {
        const runId = new URL(req.url, 'http://localhost').searchParams.get('runId');
        if (!runId || !ownsTrialRun(runId))
          throw new DataError('RUN_NOT_FOUND', '找不到这次运行', 404);
        const job = discoveryJobs.get(runId);
        const completed = await readCaptureStage(runId, 'complete-run');
        if (!job && !completed)
          throw new DataError('RUN_INTERRUPTED', '任务已中断，请重新搜索', 409);
        return send(res, 200, { success: true, data: {
          runId,
          state: completed ? 'done' : job.state,
          stage: job?.stage || 'results',
          completedStages: job?.completedStages || ['keywords', 'retrieve', 'results'],
          progress: job?.progress || { phase: 'done', percent: 100, message: '已完成' },
          updates: job?.updates || [],
          keywordPlan: job?.completedStages.includes('keywords') || completed
            ? await readCaptureStage(runId, 'keyword-plan') : null,
          ...(completed ? { result: completed } : {}),
          ...(job?.error ? { error: job.error } : {}),
        } });
      } else if (req.method === 'POST' && path === '/api/discovery/run') {
        const body = await readJson(req);
        result = await orchestrator.run(body);
        await captureStage(body.runId || result.run.id, 'complete-run', result);
      } else if (req.method === 'POST' && path === '/api/discovery/plan') {
        const { runId, cardId } = await readJson(req);
        const source = await directionPlanSource(runId, cardId);
        result = await readCaptureStage(runId, source.stage);
        if (!result) {
          result = await directionPlanner.plan(source);
          await captureStage(runId, source.stage, result);
        }
      } else if (req.method === 'POST' && path === '/api/discovery/plan/start') {
        const { runId, cardId } = await readJson(req);
        const source = await directionPlanSource(runId, cardId);
        const saved = await readCaptureStage(runId, source.stage);
        if (saved) return send(res, 200, { success: true, data: { state: 'done', result: saved } });
        const jobKey = `${runId}:${cardId}`;
        if (!planJobs.has(jobKey)) {
          const job = { state: 'running', error: null };
          planJobs.set(jobKey, job);
          void Promise.resolve().then(async () => {
            try {
              const plan = await directionPlanner.plan(source);
              await captureStage(runId, source.stage, plan);
              job.state = 'done';
            } catch (error) {
              console.error('Direction plan failed:', runId, cardId, error);
              job.state = 'failed';
              job.error = error instanceof DataError
                ? { code: error.code, message: error.message }
                : { code: 'PLAN_FAILED', message: '细化方案未能完成，请重试' };
            } finally {
              setTimeout(() => planJobs.delete(jobKey), 30 * 60 * 1000).unref();
            }
          });
        }
        return send(res, 202, { success: true, data: { state: 'running' } });
      } else if (req.method === 'GET' && path === '/api/discovery/plan/status') {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const runId = params.get('runId');
        const cardId = params.get('cardId');
        const source = await directionPlanSource(runId, cardId);
        const saved = await readCaptureStage(runId, source.stage);
        if (saved) return send(res, 200, { success: true, data: { state: 'done', result: saved } });
        const job = planJobs.get(`${runId}:${cardId}`);
        if (!job) throw new DataError('PLAN_INTERRUPTED', '细化任务已中断，请重新选择方向', 409);
        return send(res, 200, { success: true, data: job });
      } else if (req.method === 'POST' && path === '/api/discovery/revise') {
        const body = await readJson(req);
        if (!ownsTrialRun(body.runId)) throw new DataError('REVISION_SOURCE_NOT_FOUND', '找不到本次推荐保存的笔记', 404);
        result = await revision.revise(body);
      } else {
        return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: '接口不存在' } });
      }
      send(res, 200, { success: true, data: result });
      }));
    } catch (error) {
      const known = error instanceof DataError;
      send(res, known ? error.status : 500, {
        success: false,
        error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '数据服务内部错误' },
      });
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const inviteCodes = (process.env.TRIAL_INVITE_CODES || '').split(',').map((code) => code.trim()).filter(Boolean);
  if (!inviteCodes.length) throw new Error('请设置 TRIAL_INVITE_CODES（逗号分隔的邀请码）');
  const trialStore = createTrialStore(process.env.TRIAL_DB_PATH);
  trialStore.prune(Number(process.env.TRIAL_RETENTION_DAYS) || 30);
  setInterval(() => trialStore.prune(Number(process.env.TRIAL_RETENTION_DAYS) || 30), 24 * 60 * 60 * 1000).unref();
  createDataServer(data, { trialStore, inviteCodes }).listen(port, host, () => {
    console.log(`数据服务已启动: http://${host}:${port}`);
  });
}
