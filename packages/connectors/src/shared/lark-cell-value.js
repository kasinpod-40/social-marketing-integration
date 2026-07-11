/**
 * Reads values returned by Lark Bitable source tables.
 * Lark may return text and URL cells as arrays of rich segments, while number
 * and date fields are usually primitive values. These helpers normalize those
 * shapes without ever coercing objects to "[object Object]".
 */
export function readLarkText(value, options = {}) {
  const allowNull = options.allowNull !== false;
  const separator = typeof options.separator === 'string' ? options.separator : '';
  const parts = collectTextParts(value);
  const text = parts.join(separator).trim();
  if (text !== '') return text;
  if (allowNull) return null;
  throw new TypeError(`${options.label ?? 'Lark text'} is required`);
}

export function readLarkUrl(value, options = {}) {
  const allowNull = options.allowNull !== false;
  const candidate = findUrlCandidate(value);
  if (candidate === null) {
    if (allowNull) return null;
    throw new TypeError(`${options.label ?? 'Lark URL'} is required`);
  }

  try {
    const url = new URL(candidate.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
    return url.toString();
  } catch {
    throw new TypeError(`${options.label ?? 'Lark URL'} must be an absolute http/https URL`);
  }
}

export function readLarkNumber(value, options = {}) {
  const allowNull = options.allowNull !== false;
  const primitive = unwrapSinglePrimitive(value);
  if (primitive === null || primitive === undefined || primitive === '') {
    if (allowNull) return null;
    throw new TypeError(`${options.label ?? 'Lark number'} is required`);
  }
  const normalized = typeof primitive === 'string' ? primitive.replace(/,/gu, '').trim() : primitive;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) throw new TypeError(`${options.label ?? 'Lark number'} must be finite`);
  return numeric;
}

function collectTextParts(value) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectTextParts(item));
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (typeof value === 'object') {
    const candidate = value.text ?? value.name ?? value.value ?? value.option ?? value.label;
    return candidate === undefined ? [] : collectTextParts(candidate);
  }
  return [];
}

function findUrlCandidate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = findUrlCandidate(item);
      if (candidate) return candidate;
    }
    return null;
  }
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object') {
    const candidate = value.link ?? value.url ?? value.text ?? null;
    return typeof candidate === 'string' && candidate.trim() !== '' ? candidate.trim() : null;
  }
  return null;
}

function unwrapSinglePrimitive(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length > 1) throw new TypeError('Lark number cell must contain a single value');
    return unwrapSinglePrimitive(value[0]);
  }
  if (value && typeof value === 'object') {
    return unwrapSinglePrimitive(value.value ?? value.text ?? null);
  }
  return value;
}
