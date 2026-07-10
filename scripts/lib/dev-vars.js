import { readFile } from 'node:fs/promises';

/**
 * Reads a Cloudflare .dev.vars style file into a plain object.
 * Supports comments, blank lines, optional export prefix, and simple quoted values.
 */
export async function readDevVars(filePath = '.dev.vars') {
  const text = await readFile(filePath, 'utf8');
  return parseDevVars(text);
}

export function parseDevVars(text) {
  const env = {};
  const lines = String(text ?? '').split(/\r?\n/);

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    env[parsed.key] = parsed.value;
  }

  return Object.freeze(env);
}

function parseLine(line) {
  const trimmed = String(line ?? '').trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;

  const normalized = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
  const equalsIndex = normalized.indexOf('=');
  if (equalsIndex <= 0) return null;

  const key = normalized.slice(0, equalsIndex).trim();
  if (!/^[A-Z0-9_]+$/.test(key)) return null;

  const rawValue = normalized.slice(equalsIndex + 1).trim();
  return Object.freeze({ key, value: unquote(stripInlineComment(rawValue)) });
}

function stripInlineComment(value) {
  if (value.startsWith('"') || value.startsWith("'")) return value;
  const hashIndex = value.indexOf(' #');
  return hashIndex === -1 ? value : value.slice(0, hashIndex).trim();
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }

  return value;
}
