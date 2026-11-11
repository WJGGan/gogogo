import { createJsonModel } from './model-json.js';

function validateGroups(raw, notes) {
  const ids = new Set(notes.map((note) => note.id));
  const anchors = new Set();
  const keys = new Set();
  return (Array.isArray(raw) ? raw : []).flatMap((group, index) => {
    const noteIds = [...new Set((Array.isArray(group.noteIds) ? group.noteIds : []).filter((id) => ids.has(id)))].slice(0, 3);
    const decisionAnchor = String(group.decisionAnchor || '').trim();
    const action = String(group.action || '').trim();
    const theme = String(group.theme || '').trim();
    const key = String(group.key || `direction-${index + 1}`);
    if (!noteIds.length || !decisionAnchor || !action || !theme || anchors.has(decisionAnchor) || keys.has(key)) return [];
    anchors.add(decisionAnchor);
    keys.add(key);
    return [{ key, theme, decisionAnchor, action, noteIds,
      decisionType: group.decisionType === 'route' ? 'route' : 'place',
      summary: String(group.summary || ''), reason: String(group.reason || ''),
      evidenceGap: String(group.evidenceGap || ''), notablePlaces: [], evidenceLevel: 'detail' }];
  }).slice(0, 3);
}

export function createResearcherAgent({ model = createJsonModel() } = {}) {
  return {
    async planDetailReads({ brief, notes, limit = 6 }) {
      const candidates = notes.map(({ id, title }) => ({ id, title }));
      let warning;
      if (model.configured && candidates.length) {
        try {
          const result = await model.complete(
            '根据用户地点和需求，从标题中选最多 limit 篇值得读正文的笔记，兼顾相关性和不同玩法。只用候选 ID。返回 JSON：{"noteIds":["..."]}。',
            { brief: { location: brief.location, request: brief.request }, candidates, limit },
          );
          const valid = new Set(notes.map((note) => note.id));
          const selected = [...new Set((Array.isArray(result.noteIds) ? result.noteIds : []).filter((id) => valid.has(id)))].slice(0, limit);
          return { noteIds: selected, provider: 'model' };
        } catch (error) { warning = error.message; }
      }
      return { noteIds: notes.slice(0, limit).map((note) => note.id), provider: 'fallback', ...(warning ? { warning } : {}) };
    },

    async analyze({ brief, notes }) {
      const detailed = notes.filter((note) => typeof note.description === 'string' && note.description.trim()).slice(0, 30);
      let groups = [];
      let provider = 'evidence-only';
      let warning;
      let unmetRequirements = [];
      if (model.configured && detailed.length) {
        try {
          const result = await model.complete(
            '根据笔记正文，选最多 3 个符合用户地点和明确限制的不同出游方向。地点不符、条件冲突、已过期的活动或证据不够的不要选；不必凑满。地点卡的 decisionAnchor 只写一个地点或街区，不要列多个备选。只引用提供的笔记 ID，不编造事实。返回 JSON：{"groups":[{"key":"...","theme":"...","decisionType":"place|route","decisionAnchor":"地点或路线","action":"活动","summary":"证据摘要","reason":"匹配原因","noteIds":["..."]}],"unmetRequirements":[]}。',
            { today: new Date().toISOString().slice(0, 10), brief: { location: brief.location, request: brief.request },
              candidates: detailed.map(({ id, title, description, comments }) => ({ id, title, description,
                comments: (comments || []).slice(0, 4).map((comment) => comment.content) })) },
          );
          groups = validateGroups(result.groups, detailed);
          unmetRequirements = Array.isArray(result.unmetRequirements)
            ? result.unmetRequirements.filter((item) => typeof item === 'string') : [];
          provider = 'model';
        } catch (error) { warning = error.message; }
      }
      if (!groups.length && !unmetRequirements.length) {
        unmetRequirements = [!detailed.length ? '没有已保存的笔记正文，暂时无法推荐' : '暂未形成有正文支持且符合需求的方向'];
      }
      const usedIds = new Set(groups.flatMap((group) => group.noteIds));
      return { provider, groups, relevantCount: usedIds.size, rejectedCount: notes.length - usedIds.size,
        detailNoteCount: detailed.length, sufficient: groups.length >= 3 && !unmetRequirements.length,
        unmetRequirements, ...(warning ? { warning } : {}) };
    },
  };
}
