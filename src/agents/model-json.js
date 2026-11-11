import { currentModelCredential } from './model-credential.js';

export function createJsonModel({
  fetchImpl = fetch,
  apiUrl = process.env.MODEL_API_URL || 'https://api.deepseek.com/chat/completions',
  apiKey = process.env.DEEPSEEK_API_KEY || process.env.MODEL_API_KEY || '',
  model = process.env.ANALYSIS_MODEL_NAME || process.env.AGENT_MODEL_NAME || process.env.MODEL_NAME || 'deepseek-v4-pro',
} = {}) {
  return {
    get configured() { return Boolean(currentModelCredential()?.apiKey || apiKey); },
    async complete(system, input) {
      const key = currentModelCredential()?.apiKey || apiKey;
      const url = currentModelCredential()?.apiUrl || apiUrl;
      const selectedModel = currentModelCredential()?.model || model;
      if (!key) throw new Error('未配置模型 API');
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: selectedModel, temperature: 0.2, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }],
        }),
        signal: AbortSignal.timeout(Number(process.env.ANALYSIS_MODEL_TIMEOUT_MS) || Number(process.env.MODEL_TIMEOUT_MS) || 90000),
      });
      if (!response.ok) throw new Error(`模型请求失败: ${response.status}`);
      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('模型响应缺少内容');
      return JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    },
  };
}
