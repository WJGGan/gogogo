import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataError } from './xiaohongshu.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const captureRoot = join(root, 'data', 'captures');

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new DataError('INVALID_INPUT', `${name} 不能为空`, 400);
  return value.trim();
}

function keyFor(kind, parts) {
  return createHash('sha256').update(JSON.stringify([kind, ...parts])).digest('hex');
}

async function saveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

class LocalWorker {
  constructor({ python = process.env.XHS_PYTHON || 'python', spawnImpl = spawn } = {}) {
    this.python = python;
    this.spawnImpl = spawnImpl;
    this.process = null;
    this.pending = new Map();
    this.buffer = '';
    this.stderr = '';
    this.queue = Promise.resolve();
  }

  start() {
    if (this.process) return;
    const child = this.spawnImpl(this.python, ['-u', join(root, 'xhs_worker.py')], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.process = child;
    this.stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk).slice(-4000); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let end;
      while ((end = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, end).trim();
        this.buffer = this.buffer.slice(end + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          const pending = this.pending.get(message.requestId);
          if (!pending) continue;
          this.pending.delete(message.requestId);
          clearTimeout(pending.timer);
          if (message.success) pending.resolve(message.data);
          else pending.reject(new DataError('LOCAL_CONNECTOR_ERROR',
            `${message.error || '本地连接器失败'}${message.traceback ? `\n${message.traceback}` : ''}`, 502));
        } catch (error) {
          this.failAll(error);
        }
      }
    });
    child.on('error', (error) => this.failAll(error));
    child.on('exit', (code) => {
      this.process = null;
      this.failAll(new Error(`本地连接器已退出 (${code})${this.stderr ? `: ${this.stderr.trim()}` : ''}`));
    });
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new DataError('LOCAL_CONNECTOR_UNAVAILABLE', error.message, 502));
    }
    this.pending.clear();
  }

  request(command, params = {}) {
    const send = async () => {
      this.start();
      const requestId = randomUUID();
      return new Promise((resolve, reject) => {
        const timeoutMs = Math.max(1000, Number(process.env.XHS_REQUEST_TIMEOUT_MS) || 90000);
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          reject(new DataError('LOCAL_CONNECTOR_TIMEOUT', `本地连接器 ${command} 超过 ${timeoutMs} 毫秒`, 504));
          this.process?.kill();
        }, timeoutMs);
        this.pending.set(requestId, { resolve, reject, timer });
        this.process.stdin.write(`${JSON.stringify({ requestId, command, ...params })}\n`, (error) => {
          if (error) {
            this.pending.delete(requestId);
            clearTimeout(timer);
            reject(new DataError('LOCAL_CONNECTOR_UNAVAILABLE', error.message, 502));
          }
        });
      });
    };
    const result = this.queue.then(send);
    this.queue = result.catch(() => {});
    return result;
  }

  close() {
    this.process?.kill();
    this.process = null;
  }
}

export function createLocalXiaohongshuData({ worker = new LocalWorker(), cacheDir = join(captureRoot, 'cache'), cacheOnly = false } = {}) {
  async function cached(kind, parts, command, params, normalize) {
    const path = join(cacheDir, `${kind}-${keyFor(kind, parts)}.json`);
    try {
      const saved = JSON.parse(await readFile(path, 'utf8'));
      const ttlDays = Number(process.env.XHS_CACHE_TTL_DAYS) || 0;
      if (ttlDays <= 0 || (Date.now() - Date.parse(saved.fetchedAt)) < ttlDays * 86400000)
        return { ...saved.normalized, cache: { hit: true, path } };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (cacheOnly) throw new DataError('CACHE_MISS', `本地没有 ${kind} 缓存`, 404);
    const raw = await worker.request(command, params);
    const normalized = normalize(raw);
    await saveJson(path, { kind, input: params, fetchedAt: new Date().toISOString(), raw, normalized });
    return { ...normalized, cache: { hit: false, path } };
  }

  return {
    async loginStatus() { return worker.request('status'); },
    async loginQrCode() { throw new DataError('NOT_SUPPORTED', '请运行 python xhs_connector.py login 扫码登录', 501); },
    async searchNotes(keyword) {
      keyword = required(keyword, 'keyword');
      return cached('search', [keyword], 'search', { keyword }, (notes) => ({
        keyword,
        count: notes.length,
        notes: notes.map((note) => ({
          ...note,
          author: { nickname: note.author || '' },
          stats: {},
        })),
      }));
    },
    async getNoteDetail(id, xsecToken) {
      id = required(id, 'id');
      xsecToken = required(xsecToken, 'xsecToken');
      return cached('detail', [id, xsecToken], 'detail', { feedId: id, xsecToken }, (detail) => ({
        ...detail,
        author: { nickname: detail.author || '' },
        comments: (detail.comments || []).map((content, index) => ({ id: `${id}-${index}`, content })),
      }));
    },
    close() { worker.close?.(); },
  };
}
