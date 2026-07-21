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


/**
 * สร้าง Client แบบ Read-only จากไฟล์ .base สำหรับ Schema Preview แบบ Offline
 * ใช้เฉพาะ Metadata/จำนวน Record และไม่คืนค่าข้อมูลในเซลล์
 */
export function createLarkBaseExportReadOnlyClient(input) {
  const source = readExportSchemaSource(input);
  const tables = [];
  const detailsByTableId = new Map();

  for (const block of source.snapshot) {
    const table = block?.schema?.data?.table;
    if (!table || typeof table !== 'object' || Array.isArray(table)) continue;
    const tableId = readOptionalText(table.meta?.id);
    if (!tableId || detailsByTableId.has(tableId)) continue;
    const name = readOptionalText(source.tableMap[tableId]?.name) ?? '';
    tables.push(Object.freeze({ tableId, name }));
    detailsByTableId.set(tableId, table);
  }

  return Object.freeze({
    async listTables() {
      return tables.map((table) => ({ ...table }));
    },
    async listFields({ tableId }) {
      const table = requireExportTable(detailsByTableId, tableId);
      const primaryKey = readOptionalText(table.primaryKey);
      return Object.entries(table.fieldMap ?? {}).map(([fieldId, field]) => ({
        fieldId,
        fieldName: readOptionalText(field?.name) ?? '',
        type: Number(field?.type ?? 0),
        isPrimary: field?.isPrimary === true || primaryKey === fieldId,
        property: field?.property && typeof field.property === 'object' ? structuredClone(field.property) : null,
        description: typeof field?.description === 'string' ? field.description : null,
      }));
    },
    async listViews({ tableId }) {
      const table = requireExportTable(detailsByTableId, tableId);
      return Object.entries(table.viewMap ?? {}).map(([viewId, view]) => ({
        viewId,
        viewName: readOptionalText(view?.name) ?? '',
        viewType: normalizeExportViewType(view?.type),
        property: view?.property && typeof view.property === 'object' ? structuredClone(view.property) : null,
      }));
    },
    async listRecordsPage({ tableId, pageSize = 1 }) {
      const table = requireExportTable(detailsByTableId, tableId);
      const count = readNonNegativeInteger(table.meta?.recordsNum);
      const limit = Math.max(1, Number(pageSize) || 1);
      const returned = Math.min(count, limit);
      return Object.freeze({
        records: Object.freeze(Array.from({ length: returned }, (_, index) => Object.freeze({
          recordId: `offline_record_${index + 1}`,
          fields: Object.freeze({}),
        }))),
        hasMore: count > returned,
        nextPageToken: count > returned ? 'offline_export_has_more' : null,
      });
    },
  });
}

function readExportSchemaSource(input) {
  const payload = normalizeExportPayload(input);
  const snapshot = decodeCompressedJson(payload.gzipSnapshot, 'gzipSnapshot');
  if (!Array.isArray(snapshot) || snapshot.length === 0) {
    throw new TypeError('Lark Base snapshot must be a non-empty array');
  }
  const rootSchema = snapshot.find((item) => item?.schema?.tableMap)?.schema;
  if (!rootSchema) throw new TypeError('Lark Base snapshot is missing tableMap');
  return Object.freeze({ snapshot, tableMap: rootSchema.tableMap ?? {} });
}

function requireExportTable(detailsByTableId, tableId) {
  const normalized = readOptionalText(tableId);
  const table = normalized ? detailsByTableId.get(normalized) : null;
  if (!table) throw new TypeError(`Unknown Lark Base export tableId: ${tableId}`);
  return table;
}

function normalizeExportViewType(value) {
  const type = Number(value);
  if (type === 1) return 'grid';
  if (type === 2) return 'kanban';
  if (type === 3) return 'gallery';
  if (type === 4) return 'gantt';
  if (type === 5) return 'form';
  return 'unknown';
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
