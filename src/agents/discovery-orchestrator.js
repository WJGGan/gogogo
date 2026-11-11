import { createAgentRun } from './runtime.js';
import { captureStage, claimTrialRun } from '../data/run-captures.js';
import { createResearcherAgent } from './researcher.js';
import { createCuratorAgent } from './curator.js';

const AGENT_NAME = 'discovery-orchestrator';
const AGENT_VERSION = '0.4.0';

export function createDiscoveryOrchestrator({ keywordAgent, discovery, researcher = createResearcherAgent(), curator = createCuratorAgent() }) {
  return {
    async run(input, { emit = () => {} } = {}) {
      const run = createAgentRun(AGENT_NAME, input, input.runId ? { id: input.runId } : {});
      if (!claimTrialRun(run.id)) throw new Error('Run ID already belongs to another user');

      emit({ type: 'stage.started', stage: 'keywords' });
      emit({ type: 'progress', phase: 'keywords', percent: 8, message: '正在根据地点和需求生成检索词' });
      run.record('delegate', '调用关键词 Agent', { agent: 'keyword-agent' });
      const keywordPlan = await keywordAgent.generate(input);
      await captureStage(run.id, 'keyword-plan', keywordPlan);
      run.record('agent_result', '关键词 Agent 返回结构化检索计划', {
        childRunId: keywordPlan.run?.id,
        provider: keywordPlan.provider,
        keywordCount: keywordPlan.keywords.length,
      });
      emit({ type: 'stage.completed', stage: 'keywords', data: keywordPlan });
      emit({ type: 'progress', phase: 'keywords', percent: 20, message: `已生成 ${keywordPlan.keywords.length} 个检索词` });

      emit({ type: 'stage.started', stage: 'retrieve' });
      run.record('tool_call', '调用小红书搜索工具', {
        tool: 'xiaohongshu.searchNotes',
        keywords: keywordPlan.keywords,
      });
      const searchResult = await discovery.search({ keywords: keywordPlan.keywords, runId: input.runId || run.id }, {
        onProgress({ completed, total, keyword, success, count }) {
          emit({ type: 'progress', phase: 'search', percent: 20 + Math.round(completed / total * 30),
            message: `搜索 ${completed}/${total}：${keyword} · ${success ? `${count} 条笔记` : '未能取得结果'}` });
        },
      });
      run.record('tool_result', '小红书搜索完成并去重', {
        resultCount: searchResult.count,
        failedQueries: searchResult.searches.filter((item) => !item.success).length,
      });
      emit({ type: 'stage.completed', stage: 'retrieve', data: searchResult });

      emit({ type: 'stage.started', stage: 'results' });
      emit({ type: 'progress', phase: 'details', percent: 52, message: '正在挑选值得细读的笔记' });
      run.record('delegate', '调用证据研究 Agent', { agent: 'researcher-agent' });
      const brief = {
        ...keywordPlan.brief,
        facets: keywordPlan.facets || [],
        recommendationScope: keywordPlan.recommendationScope || 'area',
        intentProfile: keywordPlan.intentProfile || {},
      };
      const detailPlan = await researcher.planDetailReads({ brief, notes: searchResult.notes, limit: 6 });
      await captureStage(run.id, 'detail-plan', detailPlan);
      const detailNotes = detailPlan.noteIds.map((id) => searchResult.notes.find((note) => note.id === id)).filter(Boolean);
      run.record('tool_call', '读取优先笔记正文与评论', {
        tool: 'xiaohongshu.getNoteDetail', selectedCount: detailNotes.length, planner: detailPlan.provider,
      });
      const detailResult = await discovery.readDetails({ notes: detailNotes, runId: input.runId || run.id }, {
        onProgress({ completed, total, succeeded }) {
          emit({ type: 'progress', phase: 'details', percent: 55 + Math.round(completed / Math.max(total, 1) * 25),
            message: `笔记详情 ${completed}/${total} · 已读到 ${succeeded} 篇` });
        },
      });
      const detailsById = new Map(detailResult.details.map((note) => [note.id, note]));
      const evidenceNotes = searchResult.notes.map((note) => detailsById.get(note.id) || note);
      run.record('tool_result', '笔记正文与可用评论已整合', {
        detailCount: detailResult.details.length, failures: detailResult.failures.length,
      });
      await captureStage(run.id, 'evidence-notes', evidenceNotes.map((note) => ({
        id: note.id, title: note.title, url: note.url, coverUrl: note.coverUrl,
        matchedKeywords: note.matchedKeywords || [],
        description: note.description || '', comments: note.comments || [],
      })));
      emit({ type: 'progress', phase: 'research', percent: 83, message: '正在比对笔记内容与出门需求' });
      const research = await researcher.analyze({ brief, notes: evidenceNotes });
      await captureStage(run.id, 'research', research);
      run.record('agent_result', '证据研究完成', {
        relevantCount: research.relevantCount, groupCount: research.groups.length,
        detailNoteCount: research.detailNoteCount,
      });

      run.record('delegate', '调用玩法卡编辑 Agent', { agent: 'curator-agent' });
      emit({ type: 'progress', phase: 'curation', percent: 92, message: '证据筛选完成，正在整理出游方向' });
      const curation = await curator.compose({ brief, groups: research.groups, notes: evidenceNotes });
      await captureStage(run.id, 'curation', curation);
      const cards = curation.cards;
      run.record('agent_result', '玩法卡生成完成', { cardCount: cards.length });
      emit({ type: 'stage.completed', stage: 'results', data: { count: cards.length } });
      emit({ type: 'progress', phase: 'done', percent: 100, message: `已整理 ${cards.length} 个有来源的方向` });

      const completed = run.complete(
        {
          keywordPlan, searchResult, detailPlan, detailResult: {
            requested: detailResult.requested,
            succeeded: detailResult.details.length,
            failed: detailResult.failures.length,
          }, research, curation, cards,
          quality: {
            status: cards.length === 3 ? 'complete' : 'partial',
            message: cards.length === 3 ? '' : `现有来源只支持 ${cards.length} 个不同方向`,
          },
        },
        { version: AGENT_VERSION, childRunIds: [keywordPlan.run?.id].filter(Boolean) },
      );
      return completed;
    },
  };
}
