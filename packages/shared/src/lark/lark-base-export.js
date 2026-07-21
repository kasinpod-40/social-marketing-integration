import { gunzipSync } from 'node:zlib';

/**
 * อ่าน Lark Base export (.base) แบบ Schema-only โดยไม่แตะค่าข้อมูลใน Records
 * ผลลัพธ์จงใจเก็บเฉพาะชื่อ Table, จำนวน Record/Field/View และ duplicate snapshot blocks
 */
export function analyzeLarkBaseExport(input) {
  const payload = normalizeExportPayload(input);
  const snapshot = decodeCompressedJson(payload.gzipSnapshot, 'gzipSnapshot');
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    throw new TypeError('Lark Base snapshot must be a non-empty array');
  }

  const rootSchema = snapshot.find((item) => item?.schema?.tableMap)?.schema;
  if (!rootSchema) throw new TypeError('Lark Base snapshot is missing tableMap');
  const tableMap = rootSchema.tableMap ?? {};
  const baseName = readOptionalText(rootSchema.base?.name);
  const byId = new Map();
  const duplicateSnapshotBlocks = [];

  for (const block of snapshot) {
    const table = block?.schema?.data?.table;
    if (!table || typeof table !== 'object' || Array.isArray(table)) continue;
    const meta = table.meta ?? {};
    const tableId = readOptionalText(meta.id);
    if (!tableId) continue;
    const mappedName = readOptionalText(tableMap[tableId]?.name) ?? '';
    const summary = Object.freeze({
      tableId,
      name: mappedName,
      records: readNonNegativeInteger(meta.recordsNum),
      fields: Object.keys(table.fieldMap ?? {}).length,
      views: Object.keys(table.viewMap ?? {}).length,
    });
    if (byId.has(tableId)) {
      duplicateSnapshotBlocks.push(Object.freeze({ tableId, name: mappedName }));
      continue;
    }
    byId.set(tableId, summary);
  }

  const tables = [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, 'en'));
  const totals = tables.reduce((result, table) => ({
    records: result.records + table.records,
    fields: result.fields + table.fields,
    views: result.views + table.views,
  }), { records: 0, fields: 0, views: 0 });

  return deepFreeze({
    baseName,
    snapshotBlockCount: snapshot.length,
    uniqueTableCount: tables.length,
    duplicateSnapshotBlockCount: duplicateSnapshotBlocks.length,
    totals,
    tables,
    duplicateSnapshotBlocks,
  });
}

export function redactLarkBaseAnalysisTableIds(analysis) {
  if (!analysis || typeof analysis !== 'object') throw new TypeError('analysis is required');
  return deepFreeze({
    ...analysis,
    tables: analysis.tables.map(({ tableId, ...table }) => table),
    duplicateSnapshotBlocks: analysis.duplicateSnapshotBlocks.map(({ tableId, ...table }) => table),
  });
}

function normalizeExportPayload(input) {
  if (typeof input === 'string') {
    const parsed = JSON.parse(input);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('Lark Base export root must be an object');
    }
    return parsed;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Lark Base export must be JSON text or an object');
  }
  return input;
}

function decodeCompressedJson(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  let compressed;
  try {
    compressed = Buffer.from(value, 'base64');
  } catch (error) {
    throw new TypeError(`${name} is not valid base64`, { cause: error });
  }
  try {
    return JSON.parse(gunzipSync(compressed).toString('utf8'));
  } catch (error) {
    throw new TypeError(`${name} is not valid gzip JSON`, { cause: error });
  }
}

function readNonNegativeInteger(value) {
  const number = Number(value ?? 0);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function readOptionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
