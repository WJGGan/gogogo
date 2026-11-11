import { DataError } from './data/xiaohongshu.js';
import { captureStage } from './data/run-captures.js';

function normalizeKeywords(value) {
  if (!Array.isArray(value)) throw new DataError('INVALID_INPUT', 'keywords 必须是数组', 400);
  const keywords = [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, 4);
  if (!keywords.length) throw new DataError('INVALID_INPUT', 'keywords 不能为空', 400);
  return keywords;
}

export function createDiscoveryService({ data, failFast = false }) {
  return {
    async search(input, { onProgress = () => {} } = {}) {
      const keywords = normalizeKeywords(input?.keywords).slice(0, 2);
      const searches = [];
      const merged = new Map();

      for (const keyword of keywords) {
        try {
          const result = await data.searchNotes(keyword, input?.filters);
          searches.push({ keyword, success: true, count: result.count });
          await captureStage(input?.runId, `search-${searches.length}`, result);
          for (const note of result.notes) {
            const existing = merged.get(note.id);
            if (existing) {
              existing.matchedKeywords.push(keyword);
            } else {
              merged.set(note.id, { ...note, matchedKeywords: [keyword] });
            }
          }
        } catch (error) {
          if (failFast) throw error;
          searches.push({
            keyword,
            success: false,
            count: 0,
            error: { code: error.code || 'SEARCH_FAILED', message: error.message || '搜索失败' },
          });
          await captureStage(input?.runId, `search-${searches.length}`, searches.at(-1));
        }
        onProgress({ completed: searches.length, total: keywords.length, ...searches.at(-1) });
      }

      const notes = [...merged.values()];
      if (!notes.length && searches.every((item) => !item.success)) {
        throw new DataError('ALL_SEARCHES_FAILED', '所有小红书关键词搜索均失败', 502);
      }
      const successfulQueries = searches.filter((item) => item.success).length;
      const failedQueries = searches.length - successfulQueries;
      const output = {
        keywords,
        searches,
        count: notes.length,
        notes,
        quality: {
          status: failedQueries ? 'partial' : 'complete',
          successfulQueries,
          failedQueries,
          queryCoverage: searches.length ? successfulQueries / searches.length : 0,
        },
        source: 'xiaohongshu',
        fetchedAt: new Date().toISOString(),
      };
      await captureStage(input?.runId, 'merged-search', output);
      return output;
    },
    async readDetails(input, { onProgress = () => {} } = {}) {
      const notes = Array.isArray(input?.notes) ? input.notes : [];
      const results = [];
      const failures = [];
      for (const [index, note] of notes.slice(0, 6).entries()) {
        try {
          const detail = await data.getNoteDetail(note.id, note.xsecToken);
          const enriched = { ...note, ...detail, matchedKeywords: note.matchedKeywords || [] };
          results.push(enriched);
          await captureStage(input?.runId, `detail-${index + 1}`, enriched);
        } catch (error) {
          if (failFast) throw error;
          failures.push({ id: note.id, code: error.code || 'DETAIL_FAILED', message: error.message || '笔记详情读取失败' });
          await captureStage(input?.runId, `detail-${index + 1}`, failures.at(-1));
        }
        onProgress({ completed: index + 1, total: Math.min(notes.length, 6),
          succeeded: results.length, failed: failures.length });
      }
      return { details: results, failures, requested: Math.min(notes.length, 6) };
    },
  };
}
