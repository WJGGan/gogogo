import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDiscoveryService } from '../src/discovery.js';

test('搜索和详情读取按实际完成数量报告进度', async () => {
  const data = {
    async searchNotes(keyword) {
      return { count: 1, notes: [{ id: keyword, title: keyword, xsecToken: 'test' }] };
    },
    async getNoteDetail(id) { return { id, description: `${id} 详情` }; },
  };
  const service = createDiscoveryService({ data });
  const searches = [];
  const result = await service.search({ keywords: ['第一词', '第二词'] },
    { onProgress: (event) => searches.push(event) });
  assert.deepEqual(searches.map(({ completed, total, count }) => [completed, total, count]),
    [[1, 2, 1], [2, 2, 1]]);

  const details = [];
  await service.readDetails({ notes: result.notes }, { onProgress: (event) => details.push(event) });
  assert.deepEqual(details.map(({ completed, total, succeeded }) => [completed, total, succeeded]),
    [[1, 2, 1], [2, 2, 2]]);
});
