import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function unquote(value) {
  if (value.length >= 2 && value[0] === value.at(-1) && ['"', "'"].includes(value[0])) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadEnvFile(file = resolve(process.cwd(), '.env')) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) process.env[key] = unquote(rawValue.trim());
  }
  return true;
}
