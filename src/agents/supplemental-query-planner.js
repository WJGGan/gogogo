import { createJsonModel } from './model-json.js';

function cleanKeyword(value, location) {
  const keyword = String(value || '').replace(/[\n\r，,；;。]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!keyword) return '';
  const place = String(location || '').replace(/[·,，/]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = place.split(' ').filter(Boolean);
  const withPlace = parts.some((part) => keyword.includes(part)) ? keyword : `${place} ${keyword}`;
  return withPlace.slice(0, 34).trim();
}

export function createSupplementalQueryPlanner({ model = createJsonModel() } = {}) {
  return {
    async plan({ brief, stage, card, existingKeywords = [], candidateKeywords = [], gap = '' }) {
      let proposed = '';
      let provider = 'fallback';
      if (model.configured) {
        try {
          const result = await model.complete(
            '现有笔记缺少用户要求的证据。生成一个包含地点和关键活动、且不同于已用词的补充搜索词。返回 JSON：{"keyword":"...","reason":"..."}。',
            { brief, stage, selectedCard: card ? { decisionAnchor: card.decisionAnchor, action: card.action } : null,
              existingKeywords, gap },
          );
          proposed = result.keyword;
          provider = 'model';
        } catch {}
      }
      const fallback = stage === 'detail' && card
        ? `${brief.location} ${card.decisionAnchor} ${card.action || '游玩'}`
        : candidateKeywords.find((item) => !existingKeywords.includes(item)) || `${brief.location} ${brief.request || '游玩'}`;
      const old = new Set(existingKeywords.map((keyword) => keyword.replace(/\s+/g, '')));
      const keyword = [proposed, fallback].map((item) => cleanKeyword(item, brief.location))
        .find((item) => item && !old.has(item.replace(/\s+/g, ''))) || '';
      return { keyword, provider: keyword === cleanKeyword(proposed, brief.location) ? provider : 'fallback', gap };
    },
  };
}
