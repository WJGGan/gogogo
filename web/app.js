import { createDiscoveryAgent, DISCOVERY_STAGES } from './agent-adapter.js?v=20261111-5';
import { revisionContext, resultSummary as formatResultSummary, revisionFeedback as formatRevisionFeedback } from './revision-view.js?v=20261110-2';

const agent = createDiscoveryAgent();
const form = document.querySelector('#brief-form');
const locationInput = document.querySelector('#location');
const requestInput = document.querySelector('#request');
const requestCount = document.querySelector('#request-count');
const searchButton = document.querySelector('#search-button');
const apiState = document.querySelector('#api-state');
const apiStateTitle = document.querySelector('#api-state-title');
const apiStateDescription = document.querySelector('#api-state-description');
const analysisSection = document.querySelector('#analysis');
const analysisTitle = document.querySelector('#analysis-title');
const analysisState = document.querySelector('#analysis-state');
const analysisSummary = document.querySelector('#analysis-input-summary');
const analysisMessage = document.querySelector('#analysis-message');
const analysisProgressBar = document.querySelector('#analysis-progress-bar');
const analysisUpdates = document.querySelector('#analysis-updates');
const analysisSteps = [...document.querySelectorAll('[data-analysis-step]')];
const keywordList = document.querySelector('#keyword-list');
const retrievalSummary = document.querySelector('#retrieval-summary');
const retrievalTotalCount = document.querySelector('#retrieval-total-count');
const retrievalUniqueCount = document.querySelector('#retrieval-unique-count');
const retrievalQueries = document.querySelector('#retrieval-queries');
const ideasSection = document.querySelector('#ideas');
const ideasGrid = document.querySelector('#ideas-grid');
const resultCount = document.querySelector('#result-count');
const resultSummary = document.querySelector('#result-summary');
const directionLegend = document.querySelector('#direction-legend');
const itinerarySection = document.querySelector('#itinerary');
const selectedDirectionTitle = document.querySelector('#selected-direction-title');
const selectedDirectionAction = document.querySelector('#selected-direction-action');
const selectedDirectionSummary = document.querySelector('#selected-direction-summary');
const selectedDirectionPlanStatus = document.querySelector('#selected-direction-plan-status');
const selectedDirectionPlan = document.querySelector('#selected-direction-plan');
const selectedDirectionPlacesWrap = document.querySelector('#selected-direction-places-wrap');
const selectedDirectionPlaces = document.querySelector('#selected-direction-places');
const selectedDirectionCaveat = document.querySelector('#selected-direction-caveat');
const selectedDirectionSources = document.querySelector('#selected-direction-sources');
const noteOpenHint = document.querySelector('#note-open-hint');
const revisionSection = document.querySelector('#revision');
const revisionForm = document.querySelector('#revision-form');
const revisionLocation = document.querySelector('#revision-location');
const revisionRequest = document.querySelector('#revision-request');
const revisionButton = document.querySelector('#revision-button');
const revisionStatus = document.querySelector('#revision-status');
const revisionHint = document.querySelector('#revision-hint');
const revisionTitle = document.querySelector('#revision-title');
const revisionStage = document.querySelector('#revision-stage');
const revisionIntro = document.querySelector('#revision-intro');
const revisionVersion = document.querySelector('#revision-version');
const revisionFeedback = document.querySelector('#revision-feedback');
const revisionFeedbackTitle = document.querySelector('#revision-feedback-title');

const stageCopy = {
  keywords: '正在生成检索关键词',
  retrieve: '正在搜索小红书',
  results: '正在整理搜索结果',
};
const cachedMode = new URLSearchParams(window.location.search).get('cached') === '1';
const mockMode = new URLSearchParams(window.location.search).get('mock') === '1';
let apiReady = false;
searchButton.disabled = true;

function showApiState(ready, title, description) {
  apiReady = ready;
  apiState.classList.toggle('is-ready', ready);
  apiStateTitle.textContent = title;
  apiStateDescription.textContent = description;
  searchButton.disabled = !ready;
}

async function checkApiState() {
  if (cachedMode || mockMode) {
    showApiState(true, '演示模式已就绪', '当前使用演示数据。');
    return;
  }
  const token = sessionStorage.getItem('gogogo-trial-token');
  const mode = sessionStorage.getItem('gogogo-api-mode');
  if (!token || !mode) {
    showApiState(false, '尚未配置 API', '请先设置邀请码或自己的 API。');
    return;
  }
  const headers = { Authorization: `Bearer ${token}` };
  if (mode === 'own') {
    const apiKey = sessionStorage.getItem('gogogo-own-api-key');
    const apiUrl = sessionStorage.getItem('gogogo-own-api-url');
    const model = sessionStorage.getItem('gogogo-own-model');
    if (!apiKey || !apiUrl || !model) {
      showApiState(false, 'API 配置不完整', '请填写接口 URL、模型 ID 和 API Key。');
      return;
    }
    Object.assign(headers, { 'X-Model-Api-Key': apiKey, 'X-Model-Api-Url': apiUrl, 'X-Model-Name': model });
  }
  try {
    const response = await fetch('/api/auth/status', { headers });
    const payload = await response.json();
    if (!response.ok || !payload.data?.configured) {
      showApiState(false, 'API 尚未就绪', '请检查配置或重新设置。');
      return;
    }
    showApiState(true, mode === 'own' ? '已配置自带 API' : '邀请码模式已就绪',
      mode === 'own' ? `模型：${sessionStorage.getItem('gogogo-own-model')}` : '将使用本站配置的模型服务。');
  } catch {
    showApiState(false, '无法连接服务', '请稍后重试，或检查服务是否运行。');
  }
}
checkApiState();
if (cachedMode) {
  const notice = document.createElement('p');
  notice.className = 'cache-notice';
  notice.textContent = '缓存试跑：使用已保存的上海静安笔记。请保持地点为静安，想法可以自由修改；不会重新搜索小红书。';
  form.prepend(notice);
}

let activeRun;
let currentRunId;
let currentBrief;
let currentStage = 'cards';
let currentCardId;
let selectionSerial = 0;
let revisionCount = 0;

function renderRevisionContext() {
  const view = revisionContext(currentStage, revisionCount);
  revisionTitle.textContent = view.title;
  revisionStage.textContent = view.stage;
  revisionIntro.textContent = view.intro;
  revisionHint.textContent = view.hint;
  revisionButton.textContent = view.button;
  revisionVersion.textContent = view.version;
}

function showRevisionFeedback(title, message, state = '') {
  revisionFeedback.hidden = false;
  revisionFeedback.classList.toggle('is-pending', state === 'pending');
  revisionFeedback.classList.toggle('is-error', state === 'error');
  revisionFeedbackTitle.textContent = title;
  revisionStatus.textContent = message;
}

function updateCount() {
  requestCount.textContent = String(requestInput.value.length);
}

function appendPrompt(text) {
  const current = requestInput.value.trim().replace(/[。；，,]+$/, '');
  requestInput.value = current ? `${current}，${text}。` : `${text}。`;
  requestInput.focus();
  updateCount();
}

function setBusy(isBusy) {
  form.setAttribute('aria-busy', String(isBusy));
  searchButton.disabled = isBusy || !apiReady;
  searchButton.textContent = isBusy ? '正在寻找…' : '寻找灵感';
}

function resetDiscoveryView() {
  analysisSection.classList.remove('has-error');
  ideasSection.hidden = true;
  ideasSection.classList.remove('is-revealed');
  itinerarySection.hidden = true;
  ideasGrid.replaceChildren();
  selectedDirectionPlaces.replaceChildren();
  selectedDirectionSources.replaceChildren();
  selectedDirectionPlan.replaceChildren();
  currentRunId = undefined;
  currentCardId = undefined;
  currentBrief = undefined;
  currentStage = 'cards';
  revisionCount = 0;
  revisionSection.hidden = true;
  revisionFeedback.hidden = true;
  selectionSerial += 1;
  selectedDirectionPlacesWrap.hidden = true;
  selectedDirectionCaveat.hidden = true;
  keywordList.replaceChildren();
  keywordList.hidden = true;
  retrievalSummary.hidden = true;
  retrievalQueries.replaceChildren();
  directionLegend.hidden = true;
  directionLegend.replaceChildren();
  resultCount.textContent = '0';
  analysisProgressBar.style.width = '0%';
  analysisUpdates.replaceChildren();
  analysisSteps.forEach((step) => step.classList.remove('is-active', 'is-complete'));
}

function startStage(stage, message) {
  const index = DISCOVERY_STAGES.indexOf(stage);
  analysisTitle.textContent = stageCopy[stage];
  analysisState.textContent = `分析中 · ${index + 1}/${DISCOVERY_STAGES.length}`;
  analysisMessage.textContent = message;
  analysisProgressBar.style.width = `${[8, 20, 52][index]}%`;
  analysisSteps.forEach((step, stepIndex) => {
    step.classList.toggle('is-active', stepIndex === index);
    step.classList.toggle('is-complete', stepIndex < index);
  });
}

function completeStage(stage) {
  const index = DISCOVERY_STAGES.indexOf(stage);
  const step = analysisSteps[index];
  step?.classList.remove('is-active');
  step?.classList.add('is-complete');
  analysisProgressBar.style.width = `${[20, 50, 100][index]}%`;
}

function showProgress(progress, updates) {
  analysisMessage.textContent = progress.message;
  analysisProgressBar.style.width = `${Math.max(0, Math.min(100, progress.percent || 0))}%`;
  analysisUpdates.replaceChildren(...updates.slice(-4, -1).reverse().map((update) => {
    const item = document.createElement('li');
    item.textContent = update.message;
    return item;
  }));
}

function showKeywords(keywordPlan) {
  keywordList.replaceChildren(...keywordPlan.keywords.map((keyword) => {
    const chip = document.createElement('span');
    chip.className = 'keyword-chip';
    const label = document.createElement('small');
    label.textContent = '检索词';
    const value = document.createElement('strong');
    value.textContent = keyword;
    chip.append(label, value);
    return chip;
  }));
  keywordList.hidden = false;
}

function showRetrievalSummary(searchResult) {
  const searches = searchResult.searches || [];
  const successful = searches.filter((item) => item.success);
  const totalHits = successful.reduce((sum, item) => sum + (item.count || 0), 0);
  retrievalTotalCount.textContent = String(totalHits);
  retrievalUniqueCount.textContent = `去重后 ${searchResult.count || 0} 条笔记`;
  retrievalQueries.replaceChildren(...searches.map((item) => {
    const row = document.createElement('div');
    row.className = `retrieval-query${item.success ? '' : ' is-failed'}`;
    const keyword = document.createElement('span');
    keyword.textContent = item.keyword;
    const count = document.createElement('strong');
    count.textContent = item.success ? `${item.count} 条` : '搜索失败';
    row.append(keyword, count);
    return row;
  }));
  retrievalSummary.hidden = false;
}

function noteUrl(source) {
  try {
    const url = new URL(source?.url);
    if (url.protocol !== 'https:' || !['www.xiaohongshu.com', 'xiaohongshu.com', 'xhslink.com', 'xhslink.cn'].includes(url.hostname)) return '';
    return url.href;
  } catch { return ''; }
}

function wechatNoteUrl(webUrl) {
  const url = new URL(webUrl);
  if (url.hostname === 'www.xiaohongshu.com' || url.hostname === 'xiaohongshu.com') {
    url.searchParams.set('xhsshare', 'WeixinSession');
  }
  return url.href;
}

async function copyNoteUrl(url, button) {
  try {
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(url); copied = true; } catch { }
    }
    if (!copied) {
      const field = document.createElement('textarea');
      field.value = url;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      copied = document.execCommand('copy');
      field.remove();
      if (!copied) throw new Error('copy failed');
    }
    button.textContent = '已复制';
  } catch {
    button.textContent = '复制失败，请长按链接';
  }
  window.setTimeout(() => { button.textContent = '复制链接'; }, 3000);
}

function createNoteLink(source, index) {
  const url = noteUrl(source);
  if (!url) return null;
  const isWechat = /MicroMessenger/i.test(navigator.userAgent);
  const row = document.createElement('div');
  row.className = 'source-link-row';
  const link = document.createElement('a');
  link.textContent = `笔记 ${index + 1} · ${source.title || '查看原文'} ↗`;
  link.href = isWechat ? wechatNoteUrl(url) : url;
  link.target = '_self';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'copy-note-link';
  copy.textContent = '复制链接';
  copy.addEventListener('click', () => copyNoteUrl(url, copy));
  row.append(link, copy);
  return row;
}

async function showSelectedDirection(card, selectedArticle) {
  const selection = ++selectionSerial;
  currentStage = 'detail';
  currentCardId = card.id;
  renderRevisionContext();
  revisionFeedback.hidden = true;
  ideasGrid.querySelectorAll('.idea-card').forEach((article) => {
    article.classList.toggle('selected', article === selectedArticle);
    const button = article.querySelector('.select-direction-button');
    if (button) button.textContent = article === selectedArticle ? '已选择 · 查看下方细节' : '选择这个方向 · 查看细节';
  });
  selectedDirectionTitle.textContent = card.title || card.decisionAnchor || '已选方向';
  selectedDirectionAction.textContent = card.action || card.hook || '';
  selectedDirectionSummary.textContent = card.details?.summary || card.evidenceSummary || '暂无更多笔记摘要。';
  selectedDirectionPlan.replaceChildren();
  selectedDirectionPlanStatus.textContent = '正在依据已保存的笔记正文细化…';
  selectedDirectionPlaces.replaceChildren();
  const places = card.details?.notablePlaces || [];
  selectedDirectionPlacesWrap.hidden = places.length === 0;
  places.forEach((place) => {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = place.name;
    item.append(name);
    if (place.excerpt) item.append(document.createTextNode(` — ${place.excerpt}`));
    selectedDirectionPlaces.append(item);
  });
  selectedDirectionCaveat.hidden = !card.caveat;
  selectedDirectionCaveat.textContent = card.caveat || '';
  selectedDirectionSources.replaceChildren(...(card.sources || []).map(createNoteLink).filter(Boolean));
  itinerarySection.hidden = false;
  window.setTimeout(() => itinerarySection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  if (!currentRunId || typeof agent.planDirection !== 'function') {
    selectedDirectionPlanStatus.textContent = '当前演示仅展示已整理的笔记摘要。';
    return;
  }
  try {
    const plan = await agent.planDirection(currentRunId, card.id);
    if (selection !== selectionSerial) return;
    selectedDirectionPlanStatus.textContent = plan.limitation
      || `已阅读 ${plan.notesRead} 篇笔记正文，按来源整理为 ${plan.steps.length} 步。`;
    selectedDirectionPlan.replaceChildren(...plan.steps.map((step) => {
      const item = document.createElement('li');
      const heading = document.createElement('strong');
      heading.textContent = `${step.place} · ${step.action}`;
      const evidence = document.createElement('p');
      evidence.textContent = `笔记依据：${step.excerpt}（${step.sourceTitle}）`;
      item.append(heading, evidence);
      return item;
    }));
  } catch (error) {
    if (selection === selectionSerial) selectedDirectionPlanStatus.textContent = `暂未完成细化：${error.message}`;
  }
}

function createIdeaCard(card, index) {
  const article = document.createElement('article');
  article.className = 'idea-card';
  article.style.setProperty('--reveal-delay', `${index * 110}ms`);
  article.dataset.cardId = card.id;

  const flag = document.createElement('div');
  flag.className = 'card-direction';
  const numberBadge = document.createElement('span');
  numberBadge.className = 'card-number';
  numberBadge.textContent = `方向 0${index + 1}`;
  const angle = document.createElement('span');
  angle.className = 'card-angle';
  angle.textContent = card.angle || card.title;
  flag.append(numberBadge, angle);

  const body = document.createElement('div');
  body.className = 'card-body';
  const title = document.createElement('h3');
  title.textContent = card.title || '未命名方向';
  const hook = document.createElement('p');
  hook.className = 'hook';
  hook.textContent = card.hook || '';
  const why = document.createElement('p');
  why.className = 'why';
  const whyLabel = document.createElement('span');
  whyLabel.textContent = '为什么适合你';
  why.append(whyLabel, document.createTextNode(card.whyThis || '来自相关笔记的出游灵感'));
  const placeTeaser = document.createElement('p');
  placeTeaser.className = 'place-teaser';
  placeTeaser.textContent = card.placeTeaser || '';
  placeTeaser.hidden = !card.placeTeaser;
  const caveat = document.createElement('p');
  caveat.className = 'card-caveat';
  caveat.textContent = card.caveat || (card.evidenceLevel === 'detail'
    ? '综合参考笔记正文与评论整理；营业与现场情况请出发前确认。'
    : '根据笔记标题整理，具体体验待选中后核实。');

  const meta = document.createElement('div');
  meta.className = 'meta';
  const stats = document.createElement('span');
  stats.textContent = `参考笔记 ${card.sources?.length || 0} 篇`;
  const sourceList = document.createElement('span');
  sourceList.className = 'source-links';
  (card.sources || []).map(createNoteLink).filter(Boolean).forEach((link) => sourceList.append(link));
  meta.append(stats, sourceList);
  const selectButton = document.createElement('button');
  selectButton.type = 'button';
  selectButton.className = 'select-direction-button';
  selectButton.textContent = '选择这个方向 · 查看细节';
  selectButton.addEventListener('click', () => showSelectedDirection(card, article));
  body.append(title, hook, placeTeaser, why, caveat, selectButton, meta);
  article.append(flag, body);
  return article;
}

function showDiscoveryResults(keywordPlan, searchResult, cards = [], quality = {}, runId, isRevision = false) {
  currentRunId = runId;
  currentBrief = keywordPlan.brief;
  currentStage = 'cards';
  currentCardId = undefined;
  revisionLocation.value = currentBrief?.location || '';
  revisionRequest.value = currentBrief?.request || '';
  renderRevisionContext();
  revisionFeedback.hidden = true;
  revisionSection.hidden = false;
  itinerarySection.hidden = true;
  if (isRevision) {
    analysisSummary.textContent = `当前要求：${currentBrief?.location || ''} · ${currentBrief?.request || ''}`;
    showKeywords({ keywords: searchResult.keywords || [] });
  }
  showRetrievalSummary(searchResult);
  if (cards.length) {
    ideasGrid.replaceChildren(...cards.map(createIdeaCard));
  } else {
    const empty = document.createElement('div');
    empty.className = 'results-empty';
    empty.textContent = '现有笔记不足以组成可靠的出游方向，可以修改地点或想法后重试。';
    ideasGrid.replaceChildren(empty);
  }
  resultCount.textContent = String(cards.length);
  resultSummary.textContent = formatResultSummary(searchResult, cards, quality, isRevision);
  directionLegend.replaceChildren(...cards.map((card, index) => {
    const item = document.createElement('div');
    item.className = 'direction-legend-item';
    const number = document.createElement('b');
    number.textContent = `0${index + 1}`;
    const label = document.createElement('span');
    label.textContent = card.angle || card.title;
    item.append(number, label);
    return item;
  }));
  directionLegend.hidden = cards.length === 0;
  noteOpenHint.hidden = !/MicroMessenger/i.test(navigator.userAgent);
  analysisTitle.textContent = '出游方向已整理好';
  analysisState.textContent = `完成 · ${cards.length} 个方向`;
  analysisMessage.textContent = `${isRevision ? '已根据修改要求重算方向。' : '关键词、证据筛选和玩法卡已完成。'}运行编号：${runId}`;
  analysisProgressBar.style.width = '100%';
  analysisSteps.forEach((step) => {
    step.classList.remove('is-active');
    step.classList.add('is-complete');
  });
  ideasSection.hidden = false;
  requestAnimationFrame(() => ideasSection.classList.add('is-revealed'));
  window.setTimeout(() => ideasSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 280);
}

revisionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!revisionForm.reportValidity() || !currentRunId || typeof agent.revise !== 'function') return;
  revisionButton.disabled = true;
  revisionButton.textContent = '正在调整…';
  showRevisionFeedback('正在检查笔记池', '先用已保存的笔记重算，并核对新要求有哪些证据支持。', 'pending');
  try {
    const result = await agent.revise({ runId: currentRunId, stage: currentStage,
      cardId: currentCardId, location: revisionLocation.value.trim(), request: revisionRequest.value.trim() });
    currentBrief = result.output.keywordPlan.brief;
    currentRunId = result.run.id;
    revisionCount += 1;
    if (result.kind === 'cards') {
      showDiscoveryResults(result.output.keywordPlan, result.output.searchResult,
        result.output.cards, result.output.quality, result.run.id, true);
      const feedback = formatRevisionFeedback(result);
      showRevisionFeedback(feedback.title, feedback.message);
    } else {
      const card = result.output.cards.find((item) => item.id === currentCardId);
      const article = [...ideasGrid.querySelectorAll('.idea-card')].find((item) => item.dataset.cardId === currentCardId);
      if (card) await showSelectedDirection(card, article);
      const feedback = formatRevisionFeedback(result);
      showRevisionFeedback(feedback.title, feedback.message);
    }
    revisionLocation.value = currentBrief?.location || '';
    revisionRequest.value = currentBrief?.request || '';
  } catch (error) {
    showRevisionFeedback('这次调整没有完成', error.message || '请稍后重试', 'error');
  } finally {
    revisionButton.disabled = false;
    renderRevisionContext();
  }
});

document.querySelectorAll('[data-revision-jump]').forEach((button) => {
  button.addEventListener('click', () => {
    revisionSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => revisionRequest.focus({ preventScroll: true }), 350);
  });
});

async function runDiscovery(brief, signal) {
  for await (const event of agent.discover(brief, { signal })) {
    if (event.type === 'stage.started') startStage(event.stage, event.message);
    if (event.type === 'stage.completed') completeStage(event.stage);
    if (event.type === 'keywords.ready') showKeywords(event.keywordPlan);
    if (event.type === 'progress.updated') showProgress(event.progress, event.updates);
    if (event.type === 'discovery.results') showDiscoveryResults(event.keywordPlan, event.searchResult, event.cards, event.quality, event.runId);
  }
}

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => appendPrompt(button.dataset.prompt));
});

requestInput.addEventListener('input', updateCount);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!locationInput.reportValidity()) return;

  activeRun?.abort();
  const controller = new AbortController();
  activeRun = controller;
  const location = locationInput.value.trim();
  const request = requestInput.value.trim();
  const brief = { location, request };
  sessionStorage.setItem('gogogo-brief', JSON.stringify(brief));

  resetDiscoveryView();
  analysisSummary.textContent = request
    ? `将根据：${location} · ${request}`
    : `将根据：${location} · 暂无其他要求，先看看三个不同方向。`;
  analysisSection.hidden = false;
  analysisSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setBusy(true);

  try {
    await runDiscovery(brief, controller.signal);
  } catch (error) {
    if (error.name === 'AbortError') return;
    analysisTitle.textContent = '这次没有顺利完成';
    analysisState.textContent = '可以重试';
    analysisMessage.textContent = `${error.message || '分析失败'}。请稍后重试。`;
    analysisSection.classList.add('has-error');
  } finally {
    if (!controller.signal.aborted) setBusy(false);
  }
});

updateCount();

if (new URLSearchParams(window.location.search).get('demo') === '1') {
  window.setTimeout(() => form.requestSubmit(), 120);
}
