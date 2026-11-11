import { createJsonModel } from './model-json.js';

function asSource(note) {
  return { id: note.id, title: note.title, url: note.url, coverUrl: note.coverUrl };
}

function validateCards(rawCards, groups, notes) {
  if (!Array.isArray(rawCards)) return [];
  const byId = new Map(notes.map((note) => [note.id, note]));
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const groupOrder = new Map(groups.map((group, index) => [group.key, index]));
  const usedGroups = new Set();
  return rawCards.map((card) => {
    const group = byKey.get(card.groupKey);
    if (!group || usedGroups.has(group.key)) return null;
    const decisionAnchor = String(group.decisionAnchor || '').trim().slice(0, 36);
    const decisionType = group.decisionType === 'route' ? 'route' : 'place';
    const action = String(group.action || '').trim().slice(0, 60);
    // A place card must point to one destination; list-like anchors are not
    // actionable and commonly signal that unrelated neighborhoods were mixed.
    if (!decisionAnchor || !action) return null;
    if (decisionType === 'place' && /、|和|与|及|\/|；|;/.test(decisionAnchor)) return null;
    const sources = [...new Set(card.sourceIds || [])]
      .filter((id) => group.noteIds.includes(id) && byId.get(id)?.url && byId.get(id)?.description?.trim())
      .map((id) => asSource(byId.get(id)));
    if (!sources.length) return null;
    usedGroups.add(group.key);
    const titleAnchor = decisionAnchor;
    const conciseSuffix = String(group.theme || action).replace(/^在|^去/, '').slice(0, 18);
    const availableSuffixLength = Math.max(4, 39 - titleAnchor.length);
    const title = `${titleAnchor}：${conciseSuffix.slice(0, availableSuffixLength)}`.slice(0, 40);
    const namedPlaces = group.notablePlaces || [];
    const removeStoreNames = (value) => namedPlaces.reduce((text, place) => text.replaceAll(place.name, ''), String(value || ''))
      .replace(/\s{2,}/g, ' ').trim();
    const hook = removeStoreNames(card.hook);
    return {
      id: group.key,
      title,
      angle: removeStoreNames(card.angle || group.theme).slice(0, 16) || group.theme.slice(0, 16),
      hook: /或者|或|任选|备选|都可以|也可以/.test(hook) || !hook
        ? action
        : hook.slice(0, 100),
      // Researcher owns evidence and suitability; Curator formats the decision
      // card but cannot introduce a second, unsupported interpretation.
      whyThis: removeStoreNames(group.reason || card.whyThis).slice(0, 120),
      evidenceSummary: String(group.summary || card.evidenceSummary || '').trim().slice(0, 220),
      details: {
        summary: String(group.summary || '').trim().slice(0, 600),
        notablePlaces: namedPlaces,
      },
      placeTeaser: namedPlaces.length ? `笔记提到：${namedPlaces.map((place) => place.name).slice(0, 3).join('、')}` : '',
      decisionType,
      decisionAnchor,
      action: String(group.action || action).trim().slice(0, 60),
      caveat: String(group.evidenceGap || card.caveat || '').trim().slice(0, 120),
      sources,
      evidenceLevel: group.evidenceLevel || 'title',
    };
  }).filter((card) => card?.title && card.sources.length)
    .sort((left, right) => (groupOrder.get(left.id) ?? 99) - (groupOrder.get(right.id) ?? 99))
    .slice(0, 3);
}

export function createCuratorAgent({ model = createJsonModel() } = {}) {
  return {
    async compose({ brief, groups, notes }) {
      const detailedIds = new Set(notes.filter((note) => note.description?.trim()).map((note) => note.id));
      groups = groups.map((group) => ({ ...group, noteIds: group.noteIds.filter((id) => detailedIds.has(id)) }))
        .filter((group) => group.noteIds.length);
      const byId = new Map(notes.map((note) => [note.id, note]));
      const evidence = groups.slice(0, 3).map((group) => ({
        key: group.key,
        theme: group.theme,
        decisionType: group.decisionType,
        decisionAnchor: group.decisionAnchor,
        action: group.action,
        notablePlaces: group.notablePlaces,
        evidenceGap: group.evidenceGap,
        reason: group.reason,
        summary: group.summary,
        notes: group.noteIds.map((id) => byId.get(id)).filter(Boolean).map(({ id, title, description, comments }) => ({
          id, title, description: (description || '').slice(0, 900),
          comments: (comments || []).slice(0, 3).map((comment) => (comment.content || '').slice(0, 140)),
        })),
      }));
      let cards = [];
      let provider = 'fallback';
      let warning;
      if (model.configured && evidence.length) {
        try {
          const result = await model.complete(
            '把研究方向写成简短的出游卡片。每张卡只讲一个玩法，符合用户需求，卡片之间有区别；只引用该方向的笔记 ID，不添加无来源的事实。返回 JSON：{"cards":[{"groupKey":"...","decisionAnchor":"...","action":"...","angle":"...","title":"...","hook":"...","whyThis":"...","evidenceSummary":"...","caveat":"...","sourceIds":["..."]}]}。',
            { brief, evidence },
          );
          cards = validateCards(result.cards, groups, notes);
          provider = 'model';
        } catch (error) { warning = error.message; }
      }
      const covered = new Set(cards.map((card) => card.id));
      if (cards.length < 3) {
        const completionCards = groups.filter((group) => !covered.has(group.key)).slice(0, 3 - cards.length).map((group) => ({
          groupKey: group.key,
          decisionAnchor: group.decisionAnchor,
          action: group.action,
          angle: group.theme,
          title: group.decisionAnchor ? `${group.decisionAnchor}：${group.action || group.theme}` : group.theme,
          hook: group.action || group.theme,
          whyThis: group.reason,
          sourceIds: group.noteIds,
        }));
        cards = [...cards, ...validateCards(completionCards, groups, notes)].slice(0, 3);
      }
      return { provider, cards, ...(warning ? { warning } : {}) };
    },
  };
}
