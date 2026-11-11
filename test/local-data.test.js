import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLocalXiaohongshuData } from '../src/data/local-xiaohongshu.js';

test('本地连接器保存原始与标准化数据，重复关键词命中缓存', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'gogogo-local-data-'));
  const calls = [];
  const worker = {
    async request(command, params) {
      calls.push({ command, params });
      if (command === 'search') return [{ id: 'n1', xsecToken: 'token', title: '安静散步', author: '作者', url: 'https://example.test/n1' }];
      return { id: 'n1', title: '安静散步', description: '街区路线', author: '作者', comments: ['值得去'] };
    },
  };
  try {
    const data = createLocalXiaohongshuData({ worker, cacheDir });
    const first = await data.searchNotes('上海散步');
    const second = await data.searchNotes('上海散步');
    assert.equal(first.cache.hit, false);
    assert.equal(second.cache.hit, true);
    assert.equal(calls.length, 1);
    assert.equal(second.notes[0].author.nickname, '作者');
    const detail = await data.getNoteDetail('n1', 'token');
    assert.equal(detail.comments[0].content, '值得去');
    assert.deepEqual(calls[1], { command: 'detail', params: { feedId: 'n1', xsecToken: 'token' } });
    const files = await readdir(cacheDir);
    assert.equal(files.length, 2);
    const saved = JSON.parse(await readFile(join(cacheDir, files.find((name) => name.startsWith('search-'))), 'utf8'));
    assert.equal(saved.raw[0].title, '安静散步');
    assert.equal(saved.normalized.notes[0].id, 'n1');
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('Python 工作进程按 UTF-8 读取 Node 的 JSON 消息', async () => {
  const child = spawn(process.env.XHS_PYTHON || 'python', ['-u', 'xhs_worker.py'], {
    cwd: new URL('../', import.meta.url),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stdin.end(`${JSON.stringify({ requestId: '静安🚶', command: 'invalid' })}\n`);
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  assert.equal(code, 0);
  const response = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(response.requestId, '静安🚶');
  assert.equal(response.success, false);
});
