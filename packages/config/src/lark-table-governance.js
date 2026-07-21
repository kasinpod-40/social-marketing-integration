import { permanentError } from '../../shared/src/errors/runtime-error.js';

export const LARK_TABLE_GOVERNANCE_VERSION = 'lark-table-governance-v1';

/**
 * ตารางที่ Schema/Lifecycle ถูกควบคุมโดยระบบภายนอกและระบบเรามีสิทธิ์อ่านเท่านั้น
 * ห้าม Schema installer เปลี่ยนชื่อ สร้าง Field หรือ Update Field ในตารางเหล่านี้
 */
export const PROTECTED_LARK_TABLES = deepFreeze([
  {
    key: 'rawTikTokCreatorVideos',
    logicalName: 'RAW_TikTok_Creator_Videos',
    owner: 'lark_native_tiktok_for_creator',
    accessMode: 'read_only_source',
    mutationPolicy: 'deny_all_schema_and_business_writes',
    reason: 'Lark Native TikTok Sync owns the source schema and continuously writes source records.',
  },
]);

const PROTECTED_KEYS = new Set(PROTECTED_LARK_TABLES.map((table) => table.key));
const PROTECTED_NAMES = new Set(PROTECTED_LARK_TABLES.map((table) => canonicalTableName(table.logicalName)));

export function findProtectedLarkTableMatch(tableContract) {
  if (!tableContract || typeof tableContract !== 'object') return null;
  if (PROTECTED_KEYS.has(tableContract.key)) {
    return PROTECTED_LARK_TABLES.find((table) => table.key === tableContract.key) ?? null;
  }

  const names = [tableContract.logicalName, tableContract.createName, ...(tableContract.aliases ?? [])]
    .map(canonicalTableName)
    .filter(Boolean);
  const matchedName = names.find((name) => PROTECTED_NAMES.has(name));
  return matchedName
    ? PROTECTED_LARK_TABLES.find((table) => canonicalTableName(table.logicalName) === matchedName) ?? null
    : null;
}

export function assertSchemaDoesNotTargetProtectedTables(schema) {
  if (!Array.isArray(schema)) throw new TypeError('schema must be an array');
  for (const tableContract of schema) {
    const protectedTable = findProtectedLarkTableMatch(tableContract);
    if (!protectedTable) continue;
    throw permanentError(`Schema installer cannot mutate protected table ${protectedTable.logicalName}`, {
      code: 'LARK_PROTECTED_TABLE_MUTATION_BLOCKED',
      details: {
        protectedTableKey: protectedTable.key,
        protectedTableName: protectedTable.logicalName,
        owner: protectedTable.owner,
        accessMode: protectedTable.accessMode,
        mutationPolicy: protectedTable.mutationPolicy,
        requestedTableKey: tableContract?.key ?? null,
        requestedLogicalName: tableContract?.logicalName ?? null,
      },
    });
  }
  return true;
}

export function canonicalTableName(value) {
  if (typeof value !== 'string' || value.trim() === '') return '';
  return value
    .normalize('NFKC')
    .trim()
    .replace(/^[^\p{L}\p{N}_]+/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
