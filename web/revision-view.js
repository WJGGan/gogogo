export function revisionContext(stage, count = 0) {
  const detail = stage === 'detail';
  return {
    title: detail ? '把这个方案再调一调' : '让三个方向更贴合你',
    stage: detail ? '当前：已选方案' : '当前：三个方向',
    intro: detail
      ? '修改你现在的完整要求，我们会先查看这张卡片对应的笔记。'
      : '修改你现在的完整要求，我们会先复用已经收集的笔记。',
    hint: detail
      ? '优先重做已选方案；更换地点则重新推荐方向。证据不足时会显示待补证检索词。'
      : '优先重做三个方向；证据不足时会显示待补证检索词。',
    button: detail ? '更新这个方案' : '重新整理三个方向',
    version: count ? `已修改 ${count} 次` : '初始版本',
  };
}

export function resultSummary(searchResult, cards, quality, isRevision = false) {
  const search = searchResult.quality?.status === 'partial'
    ? `有 ${searchResult.quality.failedQueries} 个检索词未取得结果，已保留可用笔记。`
    : isRevision ? '已复用本地笔记池。' : '全部关键词搜索完成。';
  return `笔记池现有 ${searchResult.count} 条去重笔记；${search}${quality.message
    ? ` ${quality.message}` : ` 已整理为 ${cards.length} 个不同方向。`}`;
}

export function revisionFeedback(result) {
  const partial = result.output.quality?.status === 'partial';
  if (result.kind === 'cards') return {
    title: partial ? '方向已更新，证据仍有限' : '三个方向已更新',
    message: result.output.quality?.message || (result.newLocation
      ? '已按新地点重新检索并整理方向。'
      : result.searchAttempted
        ? `补证检索词：${result.supplementalKeyword}；当前笔记池 ${result.output.searchResult.count} 篇。`
        : `复用笔记池中的 ${result.output.searchResult.count} 篇笔记。`),
  };
  return {
    title: partial ? '方案已更新，证据仍有限' : '详细方案已更新',
    message: result.output.quality?.message || (result.searchAttempted
      ? `补证检索词：${result.supplementalKeyword}；已重新核对笔记原文。`
      : '已使用这张卡片的已保存笔记，并重新核对每一步的原文。'),
  };
}
