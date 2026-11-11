const DEFAULT_BASE_URL = 'http://127.0.0.1:18060';

export class DataError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'DataError';
    this.code = code;
    this.status = status;
  }
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DataError('INVALID_INPUT', `${field} 不能为空`, 400);
  }
  return value.trim();
}

function noteUrl(id, token, source = 'pc_search') {
  const url = new URL(`https://www.xiaohongshu.com/explore/${encodeURIComponent(id)}`);
  url.searchParams.set('xsec_token', token);
  url.searchParams.set('xsec_source', source);
  return url.toString();
}

function normalizeSearchFeed(feed) {
  if (!feed || feed.modelType !== 'note' || !feed.id || !feed.xsecToken) return null;
  const card = feed.noteCard ?? {};
  return {
    id: feed.id,
    xsecToken: feed.xsecToken,
    url: noteUrl(feed.id, feed.xsecToken),
    title: card.displayTitle ?? '',
    type: card.type ?? '',
    author: {
      id: card.user?.userId ?? '',
      nickname: card.user?.nickname || card.user?.nickName || '',
      avatar: card.user?.avatar ?? '',
    },
    coverUrl: card.cover?.urlDefault || card.cover?.url || card.cover?.urlPre || '',
    stats: {
      likes: card.interactInfo?.likedCount ?? '',
      comments: card.interactInfo?.commentCount ?? '',
      favorites: card.interactInfo?.collectedCount ?? '',
    },
  };
}

function normalizeComment(comment) {
  return {
    id: comment.id ?? '',
    content: comment.content ?? '',
    createdAt: comment.createTime || null,
    likes: comment.likeCount ?? '',
    author: {
      id: comment.userInfo?.userId ?? '',
      nickname: comment.userInfo?.nickname || comment.userInfo?.nickName || '',
    },
    replies: (comment.subComments ?? []).map(normalizeComment),
  };
}

export function createXiaohongshuData({
  baseUrl = process.env.XHS_MCP_URL || DEFAULT_BASE_URL,
  token = process.env.XHS_MCP_TOKEN || '',
  timeoutMs = Number(process.env.XHS_MCP_TIMEOUT_MS) || 90000,
  fetchImpl = fetch,
} = {}) {
  const endpoint = new URL(baseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error('XHS_MCP_URL 必须使用 http 或 https');
  }

  async function request(path, { method = 'GET', body } = {}) {
    const url = new URL(path, endpoint);
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new DataError('UPSTREAM_TIMEOUT', '小红书 MCP 请求超时', 504);
      }
      throw new DataError('UPSTREAM_UNAVAILABLE', '无法连接小红书 MCP 服务', 502);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new DataError('UPSTREAM_INVALID_RESPONSE', '小红书 MCP 返回了无效 JSON');
    }
    if (!response.ok || payload.success !== true) {
      const status = response.status === 401 ? 502 : response.status === 504 ? 504 : 502;
      throw new DataError(
        response.status === 401 ? 'UPSTREAM_UNAUTHORIZED' : 'UPSTREAM_ERROR',
        typeof payload.error === 'string' ? payload.error : '小红书 MCP 请求失败',
        status,
      );
    }
    return payload.data;
  }

  return {
    async loginStatus() {
      const data = await request('/api/v1/login/status');
      return {
        isLoggedIn: data.is_logged_in === true,
        username: data.username ?? '',
        userId: data.user_id ?? '',
      };
    },

    async loginQrCode() {
      const data = await request('/api/v1/login/qrcode');
      return {
        isLoggedIn: data.is_logged_in === true,
        timeout: data.timeout ?? '',
        image: data.img ?? '',
      };
    },

    async searchNotes(keyword, filters) {
      requiredString(keyword, 'keyword');
      const data = await request('/api/v1/feeds/search', {
        method: 'POST',
        body: { keyword: keyword.trim(), ...(filters ? { filters } : {}) },
      });
      if (!Array.isArray(data?.feeds)) {
        throw new DataError('UPSTREAM_INVALID_RESPONSE', '搜索响应缺少 feeds 列表');
      }
      const seen = new Set();
      const notes = data.feeds.map(normalizeSearchFeed).filter((note) => {
        if (!note || seen.has(note.id)) return false;
        seen.add(note.id);
        return true;
      });
      return { keyword: keyword.trim(), count: notes.length, notes };
    },

    async getNoteDetail(id, xsecToken, options = {}) {
      requiredString(id, 'id');
      requiredString(xsecToken, 'xsecToken');
      const data = await request('/api/v1/feeds/detail', {
        method: 'POST',
        body: {
          feed_id: id.trim(),
          xsec_token: xsecToken.trim(),
          load_all_comments: options.loadAllComments === true,
          ...(options.commentConfig ? { comment_config: options.commentConfig } : {}),
        },
      });
      const detail = data?.data;
      if (!detail?.note) {
        throw new DataError('UPSTREAM_INVALID_RESPONSE', '详情响应缺少 note');
      }
      const note = detail.note;
      return {
        id: note.noteId || id.trim(),
        xsecToken: note.xsecToken || xsecToken.trim(),
        url: noteUrl(note.noteId || id.trim(), note.xsecToken || xsecToken.trim()),
        title: note.title ?? '',
        description: note.desc ?? '',
        type: note.type ?? '',
        publishedAt: note.time || null,
        ipLocation: note.ipLocation ?? '',
        author: {
          id: note.user?.userId ?? '',
          nickname: note.user?.nickname || note.user?.nickName || '',
          avatar: note.user?.avatar ?? '',
        },
        images: (note.imageList ?? []).map((image) => image.urlDefault || image.urlPre).filter(Boolean),
        stats: {
          likes: note.interactInfo?.likedCount ?? '',
          comments: note.interactInfo?.commentCount ?? '',
          favorites: note.interactInfo?.collectedCount ?? '',
        },
        comments: (detail.comments?.list ?? []).map(normalizeComment),
        commentsHasMore: detail.comments?.hasMore === true,
      };
    },
  };
}
