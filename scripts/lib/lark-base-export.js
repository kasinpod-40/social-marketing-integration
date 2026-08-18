import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const GZIP_BASE64_PREFIX = 'H4sI';
const MAX_EXPANDED_STRING_BYTES = 128 * 1024 * 1024;
const MAX_RECURSION_DEPTH = 48;
const MAX_CANDIDATE_COLLECTIONS = 80;

/**
 * Reads a Lark/Feishu `.base` export as the local Source authority.
 *
 * Official Base exports are JSON containers. Some observed exports also carry
 * nested gzip+base64 JSON payloads; those are expanded locally so the caller
 * can inventory the complete exported structure without relying on a live
 * Source Base or Source app token.
 *
 * This module is strictly local/read-only and never calls Lark.
 */
export async function inspectLarkBaseExport(filePath) {
  const path = requireText(filePath, 'filePath');
  const bytes = await readFile(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const root = parseJson(bytes, 'root .base JSON');
  const expanded = expandCompressedJson(root);
  const scan = scanExport(expanded);

  return deepFreeze({
    ok: true,
    contractVersion: 'lark_base_export_authority_inspection_v1',
    mode: 'local-read-only',
    file: {
      path,
      sizeBytes: bytes.byteLength,
      sha256,
    },
    counts: scan.counts,
    names: scan.names,
    candidateCollections: scan.candidateCollections,
    compressedJsonPayloadsExpanded: scan.compressedJsonPayloadsExpanded,
    remoteMutationCount: 0,
  });
}

function parseJson(bytes, label) {
  const text = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/u, '').trim();
  if (!text) throw codedError('LARK_BASE_EXPORT_EMPTY', `${label} is empty`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw codedError('LARK_BASE_EXPORT_INVALID_JSON', `${label} is not valid JSON`, {
      cause: error?.message ?? String(error),
    });
  }
}

function expandCompressedJson(root) {
  let expandedCount = 0;
  const seen = new WeakSet();

  function visit(value, depth) {
    if (depth > MAX_RECURSION_DEPTH) {
      throw codedError('LARK_BASE_EXPORT_RECURSION_LIMIT', 'Export expansion exceeded the recursion safety limit');
    }
    if (typeof value === 'string') {
      const decoded = maybeDecodeCompressedJson(value);
      if (decoded.matched) {
        expandedCount += 1;
        return visit(decoded.value, depth + 1);
      }
      return value;
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, visit(nested, depth + 1)]));
  }

  const value = visit(root, 0);
  Object.defineProperty(value, '__larkBaseExpandedPayloadCount', {
    value: expandedCount,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return value;
}

function maybeDecodeCompressedJson(value) {
  const text = value.trim();
  if (!text.startsWith(GZIP_BASE64_PREFIX) || text.length < 16) return { matched: false, value };
  try {
    const compressed = Buffer.from(text, 'base64');
    const inflated = gunzipSync(compressed, { maxOutputLength: MAX_EXPANDED_STRING_BYTES });
    return { matched: true, value: parseJson(inflated, 'nested gzip/base64 JSON') };
  } catch {
    // Not every H4sI-looking value is necessarily an export payload. Leave it unchanged;
    // the structural scanner will still report the surrounding collection.
    return { matched: false, value };
  }
}

function scanExport(root) {
  const entities = {
    table: new Map(),
    field: new Map(),
    record: new Map(),
    view: new Map(),
    dashboard: new Map(),
    workflow: new Map(),
    role: new Map(),
  };
  const relationFields = new Set();
  const formulaFields = new Set();
  const candidateCollections = [];
  const visited = new WeakSet();

  function visit(value, path, parentHint = null) {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      if (value.length > 0 && candidateCollections.length < MAX_CANDIDATE_COLLECTIONS) {
        const firstObject = value.find((item) => item && typeof item === 'object' && !Array.isArray(item));
        if (firstObject) {
          candidateCollections.push({
            path,
            count: value.length,
            sampleKeys: Object.keys(firstObject).sort().slice(0, 30),
          });
        }
      }
      value.forEach((item, index) => visit(item, `${path}[${index}]`, parentHint));
      return;
    }

    const hint = entityHintFromPath(path, parentHint);
    const id = entityId(value, hint);
    const kind = classifyEntity({ value, id, path, hint });
    if (kind && id) {
      const target = entities[kind];
      if (!target.has(id)) target.set(id, summarizeEntity(value, id, path));
      if (kind === 'field') {
        const type = Number(value?.type ?? value?.field_type ?? value?.fieldType);
        if (type === 18) relationFields.add(id);
        if (type === 20) formulaFields.add(id);
      }
    }

    for (const [key, nested] of Object.entries(value)) {
      if (key === '__larkBaseExpandedPayloadCount') continue;
      visit(nested, `${path}.${key}`, key);
    }
  }

  visit(root, '$');

  return {
    counts: {
      tables: entities.table.size,
      fields: entities.field.size,
      records: entities.record.size,
      views: entities.view.size,
      relationFields: relationFields.size,
      formulaFields: formulaFields.size,
      dashboards: entities.dashboard.size,
      workflows: entities.workflow.size,
      advancedPermissionRoles: entities.role.size,
    },
    names: {
      tables: sortedNames(entities.table),
      dashboards: sortedNames(entities.dashboard),
      workflows: sortedNames(entities.workflow),
      roles: sortedNames(entities.role),
    },
    candidateCollections: candidateCollections
      .sort((left, right) => right.count - left.count || left.path.localeCompare(right.path))
      .slice(0, MAX_CANDIDATE_COLLECTIONS),
    compressedJsonPayloadsExpanded: Number(root?.__larkBaseExpandedPayloadCount ?? 0),
  };
}

function classifyEntity({ value, id, path, hint }) {
  if (id) {
    if (/^tbl[0-9A-Za-z_-]+$/u.test(id)) return 'table';
    if (/^fld[0-9A-Za-z_-]+$/u.test(id)) return 'field';
    if (/^rec[0-9A-Za-z_-]+$/u.test(id)) return 'record';
    if (/^vew[0-9A-Za-z_-]+$/u.test(id)) return 'view';
    if (/^wkf[0-9A-Za-z_-]+$/u.test(id)) return 'workflow';
    if (/^rol[0-9A-Za-z_-]+$/u.test(id)) return 'role';
  }

  const keyText = Object.keys(value).join(' ').toLowerCase();
  const pathText = path.toLowerCase();
  if (hint === 'table' || /(?:^|[._])tables?(?:$|[.[_])/u.test(pathText)) {
    if (hasAny(value, ['name', 'table_name', 'tableName'])) return 'table';
  }
  if (hint === 'field' || /(?:^|[._])fields?(?:$|[.[_])/u.test(pathText)) {
    if (hasAny(value, ['field_name', 'fieldName', 'name']) && hasAny(value, ['type', 'field_type', 'fieldType'])) return 'field';
  }
  if (hint === 'record' || /(?:^|[._])records?(?:$|[.[_])/u.test(pathText)) {
    if (hasAny(value, ['fields', 'record_id', 'recordId'])) return 'record';
  }
  if (hint === 'view' || /(?:^|[._])views?(?:$|[.[_])/u.test(pathText)) {
    if (hasAny(value, ['view_name', 'viewName', 'name', 'type', 'view_type', 'viewType'])) return 'view';
  }
  if (hint === 'dashboard' || pathText.includes('dashboard')) {
    if (hasAny(value, ['name', 'title']) && (keyText.includes('block') || keyText.includes('layout') || id)) return 'dashboard';
  }
  if (hint === 'workflow' || pathText.includes('workflow') || pathText.includes('automation')) {
    if (hasAny(value, ['name', 'title', 'steps']) || id) return 'workflow';
  }
  if (hint === 'role' || pathText.includes('permission') || pathText.includes('roles')) {
    if (hasAny(value, ['name', 'role_name', 'roleName', 'permissions', 'config']) || id) return 'role';
  }
  return null;
}

function entityId(value, hint) {
  const candidates = [
    value?.table_id, value?.tableId,
    value?.field_id, value?.fieldId,
    value?.record_id, value?.recordId,
    value?.view_id, value?.viewId,
    value?.dashboard_id, value?.dashboardId,
    value?.workflow_id, value?.workflowId,
    value?.role_id, value?.roleId,
    value?.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  const name = firstText(value?.name, value?.title, value?.table_name, value?.field_name, value?.view_name);
  return name && hint ? `${hint}:name:${name}` : null;
}

function entityHintFromPath(path, parentHint) {
  const source = `${parentHint ?? ''} ${path}`.toLowerCase();
  if (source.includes('dashboard')) return 'dashboard';
  if (source.includes('workflow') || source.includes('automation')) return 'workflow';
  if (source.includes('permission') || /\broles?\b/u.test(source)) return 'role';
  if (/\bviews?\b/u.test(source)) return 'view';
  if (/\bfields?\b/u.test(source)) return 'field';
  if (/\brecords?\b/u.test(source)) return 'record';
  if (/\btables?\b/u.test(source)) return 'table';
  return null;
}

function summarizeEntity(value, id, path) {
  return {
    id,
    name: firstText(
      value?.name,
      value?.title,
      value?.table_name,
      value?.tableName,
      value?.field_name,
      value?.fieldName,
      value?.view_name,
      value?.viewName,
      value?.role_name,
      value?.roleName,
    ),
    path,
  };
}

function sortedNames(map) {
  return [...map.values()].map((item) => item.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function hasAny(value, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
