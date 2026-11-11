import { createJsonModel } from './model-json.js';

function evidenceText(note) {
  return [note.description, ...(note.comments || []).map((comment) => comment.content)].filter(Boolean).join('\n');
}

function validateSteps(rawSteps, card, notes) {
  if (!Array.isArray(rawSteps)) return [];
  const byId = new Map(notes.map((note) => [note.id, note]));
  return rawSteps.slice(0, 4).map((step) => {
    const note = byId.get(step.sourceId);
    if (!note) return null;
    const excerpt = String(step.excerpt || '').trim().replace(/\s+/g, ' ');
    const body = evidenceText(note).replace(/\s+/g, ' ');
    const place = String(step.place || '').trim().slice(0, 40);
    const action = String(step.action || '').trim().slice(0, 80);
    if (!note || !excerpt || excerpt.length < 6 || !body.includes(excerpt)
      || !place || !action || !`${note.title} ${body} ${card.decisionAnchor}`.includes(place)) return null;
    return { place, action, sourceId: note.id, sourceTitle: note.title,
      excerpt: excerpt.slice(0, 120) };
  }).filter(Boolean).slice(0, card.decisionType === 'route' ? 4 : 1);
}

export function createDirectionPlanner({ model = createJsonModel() } = {}) {
  return {
    async plan({ brief, card, notes, feedback = '' }) {
      const cited = new Set((card.sources || []).map((source) => source.id));
      const detailed = notes.filter((note) => cited.has(note.id) && evidenceText(note));
      if (!detailed.length) return {
        provider: 'evidence-only', overview: card.action,
        steps: [], notesRead: 0,
        modelAvailable: model.configured,
        limitation: '这个方向目前只有搜索标题，没有已保存的笔记正文，暂时不能可靠地细化行程。',
      };
      let steps = [];
      let warning;
      let unmetRequirements = [];
      if (model.configured) {
        try {
          const result = await model.complete(
            '只规划用户选中的方向，并遵守当前要求。地点卡给 1 步，路线卡给最多 4 步；每步引用一篇笔记 ID 和正文或评论中的连续原句（至少 6 字）。没有证据的步骤不要写，无法满足的要求列在 unmetRequirements。返回 JSON：{"steps":[{"place":"...","action":"...","sourceId":"...","excerpt":"..."}],"unmetRequirements":[]}。',
            { brief, feedback, selectedDirection: { title: card.title, decisionType: card.decisionType,
              decisionAnchor: card.decisionAnchor,
              action: card.action, caveat: card.caveat },
            notes: detailed.map((note) => ({ id: note.id, title: note.title,
              description: (note.description || '').slice(0, 1800),
              comments: (note.comments || []).slice(0, 6).map((comment) => comment.content) })) },
          );
          steps = validateSteps(result.steps, card, detailed);
          unmetRequirements = Array.isArray(result.unmetRequirements)
            ? result.unmetRequirements.filter((item) => typeof item === 'string').slice(0, 3) : [];
        } catch (error) { warning = error.message; }
      }
      return {
        provider: steps.length ? 'model' : 'evidence-only',
        overview: card.action,
        steps, notesRead: detailed.length, modelAvailable: model.configured,
        limitation: steps.length ? [...unmetRequirements, card.caveat].filter(Boolean).join('；')
          : '已读取笔记正文，但暂未提取出可逐条核对的行程步骤；可查看下方原笔记。',
        unmetRequirements,
        ...(warning ? { warning } : {}),
      };
    },
  };
}
