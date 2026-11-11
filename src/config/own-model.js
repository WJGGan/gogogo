import { DataError } from '../data/xiaohongshu.js';

export function validateOwnModel({ apiKey, apiUrl, model }, allowedHosts = process.env.MODEL_ALLOWED_HOSTS || 'api.deepseek.com,api.openai.com') {
  if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 256 || /[\r\n]/.test(apiKey))
    throw new DataError('INVALID_MODEL_CONFIG', '请填写有效的 API Key', 400);
  if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/.test(model))
    throw new DataError('INVALID_MODEL_CONFIG', '请填写有效的模型名称', 400);
  let url;
  try { url = new URL(apiUrl); } catch { throw new DataError('INVALID_MODEL_CONFIG', '请填写完整的 HTTPS 接口 URL', 400); }
  const hosts = allowedHosts.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname.toLowerCase()) || url.port || url.username || url.password
    || url.search || url.hash || !url.pathname.endsWith('/chat/completions') || apiUrl.length > 512)
    throw new DataError('INVALID_MODEL_CONFIG', `请使用允许域名上的 HTTPS Chat Completions 接口（${hosts.join('、')}）`, 400);
  return { apiKey, apiUrl: url.href, model, provider: url.hostname === 'api.deepseek.com' ? 'deepseek' : 'openai-compatible' };
}
