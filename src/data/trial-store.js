import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const hash = (value) => createHash('sha256').update(value).digest('hex');

export function createTrialStore(path = resolve('data/trial.sqlite')) {
  path ||= resolve('data/trial.sqlite');
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, invite_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'invite');
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), parent_run_id TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS runs_user_idx ON runs(user_id);
    CREATE TABLE IF NOT EXISTS stages (run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, stage TEXT NOT NULL, data TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY(run_id, stage));`);
  if (!db.prepare('PRAGMA table_info(sessions)').all().some((column) => column.name === 'mode'))
    db.exec("ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'invite'");
  const insertUser = db.prepare('INSERT OR IGNORE INTO users(id, invite_hash, created_at) VALUES (?, ?, ?)');
  const userByInvite = db.prepare('SELECT id FROM users WHERE invite_hash = ?');
  const insertSession = db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at, mode) VALUES (?, ?, ?, ?)');
  const userBySession = db.prepare('SELECT user_id, expires_at, mode FROM sessions WHERE token_hash = ?');
  const insertRun = db.prepare('INSERT OR IGNORE INTO runs(id, user_id, parent_run_id, created_at) VALUES (?, ?, ?, ?)');
  const runOwner = db.prepare('SELECT user_id FROM runs WHERE id = ?');
  const saveStage = db.prepare('INSERT INTO stages(run_id, stage, data, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, stage) DO UPDATE SET data=excluded.data, saved_at=excluded.saved_at');
  const getStage = db.prepare('SELECT data FROM stages WHERE run_id = ? AND stage = ?');
  const deleteOldRuns = db.prepare('DELETE FROM runs WHERE created_at < ?');
  const deleteExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?');
  return {
    prune(days = 30) {
      if (!Number.isFinite(days) || days < 1) throw new Error('保留天数必须大于 0');
      deleteExpiredSessions.run(Date.now());
      return deleteOldRuns.run(new Date(Date.now() - days * 86400000).toISOString()).changes;
    },
    redeem(code, configuredCodes) {
      const candidate = hash(String(code || '').trim());
      const allowed = configuredCodes.some((item) => timingSafeEqual(Buffer.from(candidate), Buffer.from(hash(item))));
      if (!allowed) return null;
      insertUser.run(randomUUID(), candidate, new Date().toISOString());
      const userId = userByInvite.get(candidate).id;
      const token = randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      insertSession.run(hash(token), userId, expiresAt, 'invite');
      return { userId, token, expiresAt };
    },
    createOwnSession() {
      const userId = randomUUID();
      insertUser.run(userId, hash(`own:${userId}`), new Date().toISOString());
      const token = randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      insertSession.run(hash(token), userId, expiresAt, 'own');
      return { userId, token, expiresAt };
    },
    session(token) {
      if (!token) return null;
      const session = userBySession.get(hash(token));
      return session && session.expires_at > Date.now() ? { userId: session.user_id, mode: session.mode } : null;
    },
    authenticate(token) {
      return this.session(token)?.userId || null;
    },
    createRun(runId, userId, parentRunId = null) {
      insertRun.run(runId, userId, parentRunId, new Date().toISOString());
      return runOwner.get(runId)?.user_id === userId;
    },
    ownsRun(runId, userId) { return runOwner.get(runId)?.user_id === userId; },
    saveStage(runId, stage, value) {
      saveStage.run(runId, stage, JSON.stringify(value), new Date().toISOString());
    },
    readStage(runId, stage) {
      const row = getStage.get(runId, stage);
      return row ? JSON.parse(row.data) : null;
    },
    close() { db.close(); },
  };
}
