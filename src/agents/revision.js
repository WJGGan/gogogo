import { randomUUID } from 'node:crypto';
import { DataError } from '../data/xiaohongshu.js';
import { captureStage, readCaptureStage, claimTrialRun } from '../data/run-captures.js';
import { createAgentRun } from './runtime.js';
import { createResearcherAgent } from './researcher.js';
import { createCuratorAgent } from './curator.js';
import { createDirectionPlanner } from './direction-planner.js';
import { createSupplementalQueryPlanner } from './supplemental-query-planner.js';

function mergeNotes(previous, incoming) {
  const pool = new Map(previous.map((note) => [note.id, { ...note }]));
  for (const note of incoming) {
    const old = pool.get(note.id);
    pool.set(note.id, old ? {
      ...old, ...note,
      description: note.description || old.description || '',
      comments: note.comments?.length ? note.comments : old.comments || [],
      matchedKeywords: [...new Set([...(old.matchedKeywords || []), ...(note.matchedKeywords || [])])],
    } : { ...note });
  }
  return [...pool.values()];
}

function sourceOf(note) {
  return { id: note.id, title: note.title, url: note.url, coverUrl: note.coverUrl };
}

export function createRevisionService({ keywordAgent, discovery, orchestrator,
  researcher = createResearcherAgent(), curator = createCuratorAgent(),
  directionPlanner = createDirectionPlanner(), supplementalQueryPlanner = createSupplementalQueryPlanner(),
  supplementalSearchEnabled = process.env.SUPPLEMENTAL_SEARCH_ENABLED === '1' }) {
  return {
    async revise(input) {
      const parentRunId = String(input?.runId || '');
      const parent = await readCaptureStage(parentRunId, 'complete-run');
      const savedNotes = await readCaptureStage(parentRunId, 'evidence-notes');
      if (!parent?.output || !Array.isArray(savedNotes))
        throw new DataError('REVISION_SOURCE_NOT_FOUND', '找不到本次推荐保存的笔记', 404);
      const stage = input.stage === 'detail' ? 'detail' : input.stage === 'cards' ? 'cards' : '';
      const location = String(input.location || '').trim();
      const request = String(input.request || '').trim();
      if (!stage || !location || !request)
        throw new DataError('INVALID_INPUT', '修改节点、地点和当前完整要求不能为空', 400);
      const runId = randomUUID();
      if (!claimTrialRun(runId, parentRunId)) throw new DataError('RUN_CONFLICT', '运行编号冲突', 409);
      const oldLocation = String(parent.output.keywordPlan?.brief?.location || '').replace(/\s+/g, '');
      if (location.replace(/\s+/g, '') !== oldLocation) {
        const result = await orchestrator.run({ location, request, runId });
        await captureStage(runId, 'complete-run', result);
        await captureStage(runId, 'revision', { parentRunId, requestedStage: stage,
          effectiveStage: 'cards', reason: 'location_changed', supplementalKeyword: '' });
        return { ...result, kind: 'cards', parentRunId, newLocation: true,
          supplementalKeyword: '', searchAttempted: false };
      }

      const run = createAgentRun('revision-controller', input, { id: runId });
      const keywordPlan = await keywordAgent.generate({ location, request });
      const brief = { ...keywordPlan.brief, facets: keywordPlan.facets || [],
        recommendationScope: keywordPlan.recommendationScope || 'area',
        intentProfile: keywordPlan.intentProfile || {} };
      let notes = mergeNotes(parent.output.searchResult?.notes || [], savedNotes);
      let card = parent.output.cards?.find((item) => item.id === input.cardId);
      if (stage === 'detail' && !card)
        throw new DataError('REVISION_CARD_NOT_FOUND', '找不到当前选中的卡片', 404);
      let research;
      let curation;
      let plan;
      let cards;
      const calculate = async () => {
        if (stage === 'cards') {
          research = await researcher.analyze({ brief, notes });
          curation = await curator.compose({ brief, groups: research.groups, notes });
          cards = curation.cards;
          return research.sufficient && cards.length === 3;
        }
        plan = await directionPlanner.plan({ brief, card, notes, feedback: request });
        cards = parent.output.cards.map((item) => item.id === card.id ? card : item);
        return plan.steps.length > 0 && !(plan.unmetRequirements || []).length;
      };

      run.record('reuse_pool', '从上轮运行读取笔记池', { parentRunId, noteCount: notes.length, stage });
      let sufficient = await calculate();
      let supplementalKeyword = '';
      let searchAttempted = false;
      let supplementalDeferred = false;
      let searchError = '';
      let extraSearch;
      let supplementalFailure;
      const cannotImproveBySearch = stage === 'detail' && plan?.notesRead > 0
        && (plan.modelAvailable === false || plan.warning);
      if (!sufficient && !cannotImproveBySearch) {
        const gap = stage === 'cards'
          ? (research.unmetRequirements || []).join('；') || `仅形成 ${cards.length} 个方向`
          : (plan.unmetRequirements || []).join('；') || plan.limitation;
        const existingKeywords = parent.output.searchResult?.keywords || [];
        const query = await supplementalQueryPlanner.plan({ brief, stage, card,
          existingKeywords, candidateKeywords: keywordPlan.keywords || [], gap });
        supplementalKeyword = query.keyword;
        await captureStage(runId, 'supplemental-plan', query);
        if (supplementalKeyword && !supplementalSearchEnabled) {
          supplementalDeferred = true;
          searchError = `现有笔记不足；已规划补证检索词「${supplementalKeyword}」，待评测数据接入后执行`;
        } else if (supplementalKeyword) {
          searchAttempted = true;
          try {
            extraSearch = await discovery.search({ keywords: [supplementalKeyword], runId });
            const fresh = extraSearch.notes.filter((note) => !notes.some((old) => old.id === note.id));
            const readPlan = await researcher.planDetailReads({ brief, notes: fresh, limit: 3 });
            const details = await discovery.readDetails({ notes: fresh.filter((note) => readPlan.noteIds.includes(note.id)), runId });
            const detailedById = new Map(details.details.map((note) => [note.id, note]));
            notes = mergeNotes(notes, extraSearch.notes.map((note) => detailedById.get(note.id) || note));
            if (stage === 'detail') {
              const anchor = String(card.decisionAnchor || '').replace(/\s+/g, '');
              const anchorPrefix = anchor.slice(0, 3);
              const related = notes.filter((note) => !card.sources.some((source) => source.id === note.id)
                && note.description && anchor && (note.title.includes(anchor)
                  || (anchorPrefix.length >= 3 && note.title.includes(anchorPrefix))));
              card = { ...card, sources: [...card.sources, ...related.slice(0, 2).map(sourceOf)] };
            }
            sufficient = await calculate();
          } catch (error) {
            const failed = await readCaptureStage(runId, 'search-1');
            const cacheMiss = failed?.error?.code === 'CACHE_MISS';
            searchError = cacheMiss
              ? '本地没有这个补充关键词的缓存；缓存试跑没有访问小红书'
              : error.message || '补充检索没有取得可用笔记';
            supplementalFailure = { keyword: supplementalKeyword, success: false, count: 0,
              error: { code: failed?.error?.code || error.code || 'SUPPLEMENTAL_SEARCH_FAILED', message: searchError } };
          }
        }
      }
      run.record('revision_result', '完成本轮修改', {
        stage, sufficient, searchAttempted, supplementalDeferred, supplementalKeyword, noteCount: notes.length,
      });
      const oldSearch = parent.output.searchResult || { keywords: [], searches: [], notes: [] };
      const searchResult = { ...oldSearch,
        keywords: [...new Set([...(oldSearch.keywords || []), ...(searchAttempted ? [supplementalKeyword] : [])])],
        searches: [...(oldSearch.searches || []), ...(extraSearch?.searches || []),
          ...(supplementalFailure ? [supplementalFailure] : [])],
        notes: notes.map(({ id, title, url, coverUrl, matchedKeywords }) => ({ id, title, url, coverUrl, matchedKeywords })),
        count: notes.length,
        quality: { status: supplementalFailure ? 'partial' : oldSearch.quality?.status || 'complete',
          failedQueries: (oldSearch.quality?.failedQueries || 0) + (supplementalFailure ? 1 : 0) },
      };
      const output = { keywordPlan, searchResult,
        research: research || parent.output.research,
        curation: curation || parent.output.curation,
        cards,
        ...(plan ? { plan } : {}),
        quality: { status: sufficient ? 'complete' : 'partial',
          message: sufficient ? '' : searchError || '已保存笔记和一次补搜仍不足以完整支持本次修改' },
      };
      const completed = run.complete(output, { parentRunId, version: '0.4.0' });
      await captureStage(runId, 'evidence-notes', notes);
      if (research) await captureStage(runId, 'research', research);
      if (curation) await captureStage(runId, 'curation', curation);
      if (plan) {
        const index = cards.findIndex((item) => item.id === card.id);
        await captureStage(runId, `direction-plan-${index + 1}`, plan);
      }
      await captureStage(runId, 'revision', { parentRunId, requestedStage: stage,
        effectiveStage: stage, location, request, sufficient, supplementalKeyword,
        searchAttempted, supplementalDeferred, searchError });
      await captureStage(runId, 'complete-run', completed);
      return { ...completed, kind: stage, parentRunId, supplementalKeyword,
        searchAttempted, supplementalDeferred };
    },
  };
}
