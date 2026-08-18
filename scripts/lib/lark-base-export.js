import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const MAX_EXPANDED_STRING_BYTES = 256 * 1024 * 1024;
const REQUIRED_PAYLOAD_KEYS = Object.freeze([
  'gzipSnapshot',
  'gzipExtraInfo',
  'gzipBaseRole',
  'gzipAccessConfig',
  'gzipDashboard',
  'gzipAutomation',
]);

/**
 * Reads the exported `.base` file as the local migration authority.
 *
 * The real Lark export observed in this workstream is a JSON envelope whose
 * `gzip*` members are base64-encoded gzip JSON payloads. Snapshot entries may
 * repeat one table when data is chunked, so every resource count is deduped by
 * its exported stable ID rather than by snapshot-entry count.
 *
 * This function is local/read-only and performs zero remote requests.
 */
export async function inspectLarkBaseExport(filePath) {
  const path = requireText(filePath, 'filePath');
  const bytes = await readFile(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const envelope = parseJson(bytes, 'root .base JSON');
  const payloads = decodeExportEnvelope(envelope);
  const scan = scanCanonicalExport(payloads);

  return deepFreeze({
    ok: true,
    contractVersion: 'lark_base_export_authority_inspection_v2',
    mode: 'local-read-only',
    file: {
      path,
      sizeBytes: bytes.byteLength,
      sha256,
    },
    envelope: {
      keys: Object.keys(envelope).sort(),
      signPresent: typeof envelope?.sign === 'string' && envelope.sign.length > 0,
    },
    counts: scan.counts,
    names: scan.names,
    snapshot: scan.snapshot,
    payloads: scan.payloads,
    remoteMutationCount: 0,
  });
}

function decodeExportEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw codedError('LARK_BASE_EXPORT_INVALID_ENVELOPE', 'Root .base JSON must be an object');
  }

  const missing = REQUIRED_PAYLOAD_KEYS.filter((key) => typeof envelope[key] !== 'string' || envelope[key].trim() === '');
  if (missing.length > 0) {
    throw codedError(
      'LARK_BASE_EXPORT_PAYLOAD_MISSING',
      `Required .base payloads are missing: ${missing.join(', ')}`,
      { missing },
    );
  }

  return Object.fromEntries(REQUIRED_PAYLOAD_KEYS.map((key) => [key, decodeGzipBase64Json(envelope[key], key)]));
}

function decodeGzipBase64Json(value, label) {
  try {
    const compressed = Buffer.from(value.trim(), 'base64');
    const inflated = gunzipSync(compressed, { maxOutputLength: MAX_EXPANDED_STRING_BYTES });
    return parseJson(inflated, label);
  } catch (error) {
    if (error?.code?.startsWith?.('LARK_BASE_EXPORT_')) throw error;
    throw codedError('LARK_BASE_EXPORT_GZIP_PAYLOAD_INVALID', `${label} is not valid gzip/base64 JSON`, {
      payload: label,
      cause: error?.message ?? String(error),
    });
  }
}

function scanCanonicalExport(payloads) {
  const snapshots = requireArray(payloads.gzipSnapshot, 'gzipSnapshot');
  const dashboards = requireArray(payloads.gzipDashboard, 'gzipDashboard');
  const automations = requireArray(payloads.gzipAutomation, 'gzipAutomation');
  const roles = requireArray(payloads.gzipBaseRole, 'gzipBaseRole');

  const tables = new Map();
  const fields = new Map();
  const records = new Map();
  const views = new Map();
  const relationFields = new Set();
  const formulaFields = new Set();
  const snapshotTableOccurrences = new Map();

  for (const [snapshotIndex, entry] of snapshots.entries()) {
    const schema = requireObject(entry?.schema, `gzipSnapshot[${snapshotIndex}].schema`);
    const tableMap = requireObject(schema?.tableMap, `gzipSnapshot[${snapshotIndex}].schema.tableMap`);

    for (const [tableId, table] of Object.entries(tableMap)) {
      if (!tables.has(tableId)) {
        tables.set(tableId, {
          id: tableId,
          name: optionalText(table?.name),
        });
      }
    }

    const data = requireObject(schema?.data, `gzipSnapshot[${snapshotIndex}].schema.data`);
    const tableData = requireObject(data?.table, `gzipSnapshot[${snapshotIndex}].schema.data.table`);
    const tableId = requireText(tableData?.meta?.id, `gzipSnapshot[${snapshotIndex}].schema.data.table.meta.id`);
    snapshotTableOccurrences.set(tableId, (snapshotTableOccurrences.get(tableId) ?? 0) + 1);

    for (const [fieldId, field] of Object.entries(tableData?.fieldMap ?? {})) {
      if (!fields.has(fieldId)) fields.set(fieldId, { id: fieldId, tableId, value: field });
      const type = Number(field?.type);
      if (type === 18) relationFields.add(fieldId);
      if (type === 20) formulaFields.add(fieldId);
    }

    for (const [viewId, view] of Object.entries(tableData?.viewMap ?? {})) {
      if (!views.has(viewId)) views.set(viewId, { id: viewId, tableId, value: view });
    }

    for (const [recordId, record] of Object.entries(data?.recordMap ?? {})) {
      if (!records.has(recordId)) records.set(recordId, { id: recordId, tableId, value: record });
    }
  }

  const duplicateSnapshotTables = [...snapshotTableOccurrences.entries()]
    .filter(([, count]) => count > 1)
    .map(([tableId, count]) => ({
      tableId,
      name: tables.get(tableId)?.name ?? null,
      snapshotEntryCount: count,
    }))
    .sort((left, right) => left.tableId.localeCompare(right.tableId));

  const dashboardIdentities = dashboards.map((item, index) => String(item?.dashboardID ?? `dashboard-index:${index}`));
  const workflowIdentities = automations.map((item, index) => String(item?.id ?? `workflow-index:${index}`));
  const roleIdentities = roles.map((item, index) => String(item?.roleId ?? `role-index:${index}`));

  return {
    counts: {
      tables: tables.size,
      fields: fields.size,
      records: records.size,
      views: views.size,
      relationFields: relationFields.size,
      formulaFields: formulaFields.size,
      dashboards: new Set(dashboardIdentities).size,
      workflows: new Set(workflowIdentities).size,
      advancedPermissionRoles: new Set(roleIdentities).size,
    },
    names: {
      tables: [...tables.values()].map((table) => table.name).filter(Boolean).sort((a, b) => a.localeCompare(b)),
      roles: roles.map((role) => optionalText(role?.name)).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    },
    snapshot: {
      entryCount: snapshots.length,
      uniqueTableCount: snapshotTableOccurrences.size,
      duplicateSnapshotTables,
    },
    payloads: {
      extraInfoPresent: Boolean(payloads.gzipExtraInfo && typeof payloads.gzipExtraInfo === 'object'),
      accessConfigPresent: Boolean(payloads.gzipAccessConfig && typeof payloads.gzipAccessConfig === 'object'),
      dashboardEntryCount: dashboards.length,
      automationEntryCount: automations.length,
      roleEntryCount: roles.length,
    },
  };
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

function requireArray(value, name) {
  if (!Array.isArray(value)) {
    throw codedError('LARK_BASE_EXPORT_SCHEMA_MISMATCH', `${name} must be an array`, {
      name,
      actualType: value === null ? 'null' : typeof value,
    });
  }
  return value;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('LARK_BASE_EXPORT_SCHEMA_MISMATCH', `${name} must be an object`, {
      name,
      actualType: value === null ? 'null' : typeof value,
    });
  }
  return value;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw codedError('LARK_BASE_EXPORT_SCHEMA_MISMATCH', `${name} is required`, { name });
  }
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
