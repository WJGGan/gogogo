/** Local integration demo using saved XHS searches. No live XHS search requests. */
import { loadEnvFile } from '../src/config/env.js';
import { createLocalXiaohongshuData } from '../src/data/local-xiaohongshu.js';
import { createDataServer } from '../src/server.js';
import { DataError } from '../src/data/xiaohongshu.js';

loadEnvFile();
const data = createLocalXiaohongshuData({ cacheOnly: true });
const keywordAgent = {
  async generate(input) {
    if (typeof input.location !== 'string' || !input.location.includes('静安')) {
      throw new DataError('CACHE_SCOPE', '当前缓存试跑仅支持上海静安，请在地点中输入“静安”', 400);
    }
    return { brief: { location: input.location, request: input.request },
      keywords: ['上海 静安', '静安 散步路线'], provider: 'saved-search-fixture' };
  },
};
const server = createDataServer(data, { keywordAgent });
server.listen(3101, '127.0.0.1', () => console.log('Cached demo API: http://127.0.0.1:3101'));
process.on('SIGINT', () => { server.close(); data.close(); });
