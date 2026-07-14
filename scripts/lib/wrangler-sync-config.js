import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

/** อ่าน String vars ที่ระบุจาก wrangler JSONC โดย Fail-closed เมื่อ Key ซ้ำหรือไม่ใช่ String */
export async function readWranglerStringVars(filePath, keys) {
  const source = await readFile(filePath, 'utf8');
  const values = {};
  for (const key of keys) values[key] = readUniqueStringProperty(source, key, { required: false });
  return Object.freeze({ filePath, source, values: Object.freeze(values) });
}

/** แทนค่า String vars แบบ Atomic และบังคับให้แต่ละ Key พบเพียงหนึ่งครั้ง */
export async function updateWranglerStringVars(filePath, updates) {
  const source = await readFile(filePath, 'utf8');
  let next = source;
  const changed = [];
  for (const [key, expected] of Object.entries(updates)) {
    const current = readUniqueStringProperty(next, key, { required: true });
    const nextValue = String(expected);
    if (current === nextValue) continue;
    next = replaceUniqueStringProperty(next, key, nextValue);
    changed.push(Object.freeze({ key, from: current, to: nextValue }));
  }

  if (changed.length === 0) return Object.freeze({ changed, filePath });
  const tempPath = join(dirname(filePath), `.${randomUUID()}.wrangler-sync.tmp`);
  await writeFile(tempPath, next, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, filePath);
  return Object.freeze({ changed, filePath });
}

export function readUniqueStringProperty(source, key, options = {}) {
  const matches = findStringPropertyMatches(source, key);
  if (matches.length === 0) {
    if (options.required === false) return null;
    throw configError(`ไม่พบ ${key} ใน Wrangler config`, 'WRANGLER_CONFIG_KEY_MISSING', { key });
  }
  if (matches.length > 1) {
    throw configError(`พบ ${key} ซ้ำ ${matches.length} จุดใน Wrangler config`, 'WRANGLER_CONFIG_KEY_DUPLICATE', {
      key,
      count: matches.length,
    });
  }
  return matches[0].value;
}

export function replaceUniqueStringProperty(source, key, nextValue) {
  const matches = findStringPropertyMatches(source, key);
  if (matches.length !== 1) {
    throw configError(`แก้ ${key} ไม่ได้ เพราะต้องพบเพียงหนึ่งจุด`,
      matches.length === 0 ? 'WRANGLER_CONFIG_KEY_MISSING' : 'WRANGLER_CONFIG_KEY_DUPLICATE',
      { key, count: matches.length });
  }
  const match = matches[0];
  return `${source.slice(0, match.valueStart)}${escapeJsonString(nextValue)}${source.slice(match.valueEnd)}`;
}

function findStringPropertyMatches(source, key) {
  if (typeof source !== 'string') throw new TypeError('Wrangler config source must be a string');
  const escapedKey = escapeRegExp(key);
  const pattern = new RegExp(`"${escapedKey}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'gu');
  const matches = [];
  for (const match of source.matchAll(pattern)) {
    const rawValue = match[1];
    const full = match[0];
    const valueOffset = full.lastIndexOf(`"${rawValue}"`) + 1;
    matches.push(Object.freeze({
      value: JSON.parse(`"${rawValue}"`),
      valueStart: match.index + valueOffset,
      valueEnd: match.index + valueOffset + rawValue.length,
    }));
  }
  return matches;
}

function escapeJsonString(value) {
  return JSON.stringify(String(value)).slice(1, -1);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function configError(message, code, details) {
  return permanentError(message, { code, details });
}
