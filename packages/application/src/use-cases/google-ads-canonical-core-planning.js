import { GOOGLE_ADS_CANONICAL_CORE } from '../../../config/src/google-ads-canonical-core.js';
import { canonicalTableName } from '../../../config/src/lark-table-governance.js';

/**
 * ตรวจ Canonical Ads v2 แบบ Read-only ก่อน Google Apply.
 * Missing/type mismatch เป็น Conflict และ Google tool จะไม่สร้าง/rename/type-mutate Core เหล่านี้เอง.
 */
export async function checkGoogleAdsCanonicalCore(input) {
  const byName = groupTablesByName(input.liveTables ?? []);
  const checks = [];
  const conflicts = [];

  for (const [tableName, expectedFields] of Object.entries(GOOGLE_ADS_CANONICAL_CORE)) {
    const matches = byName.get(canonicalTableName(tableName)) ?? [];
    if (matches.length !== 1) {
      const code = matches.length > 1
        ? 'GOOGLE_ADS_CANONICAL_CORE_TABLE_AMBIGUOUS'
        : 'GOOGLE_ADS_CANONICAL_CORE_TABLE_MISSING';
      conflicts.push({
        code,
        tableName,
        matchCount: matches.length,
        message: matches.length > 1
          ? `พบ Canonical Ads core ${tableName} มากกว่าหนึ่งตาราง`
          : `ไม่พบ Canonical Ads core ${tableName}; Google Apply ห้ามสร้างตารางนี้แทน`,
      });
      checks.push({ tableName, tableId: null, status: code, fields: [] });
      continue;
    }

    const table = matches[0];
    const liveFields = await input.planningClient.listFields({ tableId: table.tableId });
    const byField = new Map();
    for (const field of liveFields) {
      const name = normalizeName(field?.fieldName);
      if (!name) continue;
      if (byField.has(name)) {
        conflicts.push({
          code: 'GOOGLE_ADS_CANONICAL_CORE_DUPLICATE_FIELD',
          tableName,
          tableId: table.tableId,
          fieldName: field.fieldName,
          message: `พบ Field ชื่อซ้ำใน Canonical Ads core ${tableName}.${field.fieldName}`,
        });
      } else {
        byField.set(name, field);
      }
    }

    const fieldChecks = [];
    for (const [fieldName, expectedType] of expectedFields) {
      const live = byField.get(normalizeName(fieldName));
      let status = 'MATCH';
      if (!live) {
        status = 'MISSING';
        conflicts.push({
          code: 'GOOGLE_ADS_CANONICAL_CORE_FIELD_MISSING',
          tableName,
          tableId: table.tableId,
          fieldName,
          expectedType,
          message: `Canonical Ads core ขาด Field ${tableName}.${fieldName}`,
        });
      } else if (Number(live.type) !== Number(expectedType)) {
        status = 'TYPE_MISMATCH';
        conflicts.push({
          code: 'GOOGLE_ADS_CANONICAL_CORE_FIELD_TYPE_MISMATCH',
          tableName,
          tableId: table.tableId,
          fieldName,
          fieldId: live.fieldId ?? null,
          expectedType,
          actualType: live.type,
          message: `Canonical Ads core type ไม่ตรง ${tableName}.${fieldName}: expected ${expectedType}, actual ${live.type}`,
        });
      }
      fieldChecks.push({
        fieldName,
        fieldId: live?.fieldId ?? null,
        expectedType,
        actualType: live?.type ?? null,
        status,
      });
    }
    checks.push({
      tableName,
      tableId: table.tableId,
      status: fieldChecks.every((field) => field.status === 'MATCH') ? 'MATCH' : 'CONFLICT',
      fields: fieldChecks,
    });
  }

  return {
    ready: conflicts.length === 0,
    checks: deepFreeze(checks),
    conflicts,
  };
}

function groupTablesByName(tables) {
  const groups = new Map();
  for (const table of tables) {
    const name = canonicalTableName(table?.name);
    if (!name) continue;
    const group = groups.get(name) ?? [];
    group.push(table);
    groups.set(name, group);
  }
  return groups;
}

function normalizeName(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
    : '';
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
