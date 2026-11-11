import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const db = new DatabaseSync(resolve(process.env.TRIAL_DB_PATH || 'data/trial.sqlite'), { readOnly: true });
const rows = db.prepare(`SELECT r.id AS runId, r.user_id AS userId, r.parent_run_id AS parentRunId,
  r.created_at AS createdAt, s.stage, s.data
  FROM runs r JOIN stages s ON s.run_id = r.id ORDER BY r.created_at, r.id, s.stage`).all();
let current = null;
for (const row of rows) {
  if (current && current.runId !== row.runId) {
    process.stdout.write(`${JSON.stringify(current)}\n`);
    current = null;
  }
  current ||= { runId: row.runId, userId: row.userId, parentRunId: row.parentRunId,
    createdAt: row.createdAt, stages: {} };
  current.stages[row.stage] = JSON.parse(row.data);
}
if (current) process.stdout.write(`${JSON.stringify(current)}\n`);
db.close();
