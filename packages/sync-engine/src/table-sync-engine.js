const PLAN_MARKER = Symbol('table-sync-plan');

/**
 * เครื่องยนต์ Sync ตารางแบบไม่ผูกกับผู้ให้บริการ Storage
 *
 * หน้าที่หลัก:
 * - ตรวจและตัดข้อมูลซ้ำจาก Input ด้วย Stable Key
 * - Serialize/Preflight ข้อมูลก่อนเขียนผ่าน Repository
 * - อ่านเฉพาะ Record ที่เกี่ยวข้องเมื่อ Repository รองรับการค้นหาด้วย Key
 * - วางแผน Create/Update/Skip โดยยังไม่เขียนข้อมูล
 * - แยกขั้น Plan ออกจาก Execute เพื่อให้หลายตารางผ่าน Preflight ก่อนเริ่มเขียนจริง
 */
export class TableSyncEngine {
  /**
   * @param {Object} [options] ตัวเลือกพฤติกรรมของ Engine
   * @param {'error'|'first'} [options.existingDuplicatePolicy] วิธีจัดการ Stable Key ซ้ำในปลายทาง
   */
  constructor(options = {}) {
    this.existingDuplicatePolicy = readDuplicatePolicy(options.existingDuplicatePolicy ?? 'error');
    this.executedPlans = new WeakSet();
  }

  /**
   * รักษา API เดิมสำหรับผู้เรียกที่ต้องการ Plan และ Execute ตารางเดียวในคำสั่งเดียว
   */
  async syncByKey(input) {
    const plan = await this.planByKey(input);
    return this.executePlan(plan, { onProgress: input?.onProgress });
  }

  /**
   * วางแผน Sync ทั้งหมดโดยยังไม่สร้างหรือแก้ไข Record ในปลายทาง
   * ขั้นนี้ใช้สำหรับจับ Schema error, Duplicate และ Diff ก่อนเริ่ม Write
   */
  async planByKey(input) {
    const repository = requireRepository(input?.repository);
    const tableId = requireText(input?.tableId, 'tableId');
    const keyField = requireText(input?.keyField, 'keyField');
    const progress = readProgress(input?.onProgress);
    const inputRows = requireArray(input?.rows, 'rows');

    progress({ stage: 'sync_deduplicating', tableId, rows: inputRows.length });
    const deduplicated = deduplicateRowsByKey(inputRows, keyField);
    progress({
      stage: 'sync_deduplicated',
      tableId,
      rows: deduplicated.rows.length,
      duplicateInputRows: deduplicated.duplicateCount,
    });

    if (deduplicated.rows.length === 0) {
      return createPlan({
        repository,
        tableId,
        keyField,
        createRows: [],
        updateRows: [],
        skipped: 0,
        duplicateInputRows: deduplicated.duplicateCount,
        inputRows: 0,
        existingRecordsRead: 0,
        existingReadStrategy: 'none',
      });
    }

    progress({ stage: 'sync_loading_schema', tableId });
    const preparedRows = await repository.prepareRows(tableId, deduplicated.rows, { keyField });
    progress({ stage: 'sync_schema_loaded', tableId, rows: preparedRows.length });

    const keyValues = preparedRows.map((row) => requireText(row?.[keyField], keyField));
    progress({ stage: 'sync_loading_existing_records', tableId, keys: keyValues.length });
    const existingRead = await readExistingRecords({ repository, tableId, keyField, keyValues });
    const comparableExisting = await normalizeExistingRecords({
      repository,
      tableId,
      records: existingRead.records,
      incomingFieldNames: collectIncomingFieldNames(preparedRows),
    });
    progress({
      stage: 'sync_existing_records_loaded',
      tableId,
      rows: comparableExisting.length,
      strategy: existingRead.strategy,
    });

    const existingIndex = buildExistingIndex(
      comparableExisting,
      keyField,
      this.existingDuplicatePolicy,
    );
    const createRows = [];
    const updateRows = [];
    let skipped = 0;

    progress({ stage: 'sync_planning', tableId });
    for (const row of preparedRows) {
      const keyValue = requireText(row?.[keyField], keyField);
      const existing = existingIndex.get(keyValue);

      if (!existing) {
        createRows.push(row);
        continue;
      }

      if (!existing.recordId) {
        throw new Error(`Destination record for ${keyField}=${keyValue} has no recordId`);
      }

      if (hasChangedFields(existing.fields, row)) {
        updateRows.push(Object.freeze({ recordId: existing.recordId, fields: row }));
      } else {
        skipped += 1;
      }
    }

    progress({
      stage: 'sync_plan_ready',
      tableId,
      createRows: createRows.length,
      updateRows: updateRows.length,
      skipped,
      strategy: existingRead.strategy,
    });

    return createPlan({
      repository,
      tableId,
      keyField,
      createRows,
      updateRows,
      skipped,
      duplicateInputRows: deduplicated.duplicateCount,
      inputRows: preparedRows.length,
      existingRecordsRead: comparableExisting.length,
      existingReadStrategy: existingRead.strategy,
    });
  }

  /**
   * เขียนข้อมูลตาม Plan ที่ผ่าน Preflight แล้ว
   * Plan เดียวกันห้าม Execute ซ้ำ เพื่อป้องกันผู้เรียกทำ Write ซ้ำโดยไม่ตั้งใจ
   */
  async executePlan(plan, options = {}) {
    const normalizedPlan = requirePlan(plan);
    const progress = readProgress(options.onProgress);

    if (this.executedPlans.has(normalizedPlan)) {
      throw new Error(`Sync plan for table ${normalizedPlan.tableId} has already been executed`);
    }
    this.executedPlans.add(normalizedPlan);

    progress({
      stage: 'sync_creating',
      tableId: normalizedPlan.tableId,
      rows: normalizedPlan.createRows.length,
    });
    const created = normalizedPlan.createRows.length === 0
      ? 0
      : readResultCount(
        (await normalizedPlan.repository.createMany(
          normalizedPlan.tableId,
          normalizedPlan.createRows,
        ))?.created,
        'created',
      );
    assertExpectedWriteCount(created, normalizedPlan.createRows.length, 'created', normalizedPlan.tableId);
    progress({ stage: 'sync_created', tableId: normalizedPlan.tableId, created });

    progress({
      stage: 'sync_updating',
      tableId: normalizedPlan.tableId,
      rows: normalizedPlan.updateRows.length,
    });
    const updated = normalizedPlan.updateRows.length === 0
      ? 0
      : readResultCount(
        (await normalizedPlan.repository.updateMany(
          normalizedPlan.tableId,
          normalizedPlan.updateRows,
        ))?.updated,
        'updated',
      );
    assertExpectedWriteCount(updated, normalizedPlan.updateRows.length, 'updated', normalizedPlan.tableId);
    progress({ stage: 'sync_updated', tableId: normalizedPlan.tableId, updated });

    return freezeResult({
      created,
      updated,
      skipped: normalizedPlan.skipped,
      duplicateInputRows: normalizedPlan.duplicateInputRows,
    });
  }
}

/**
 * ตัด Input ซ้ำด้วย Stable Key โดยให้แถวสุดท้ายชนะ
 * เหมาะกับ Batch ที่มี Snapshot ของ Entity เดียวกันหลายครั้งและแถวท้ายใหม่กว่า
 */
export function deduplicateRowsByKey(rows, keyField) {
  const normalizedKeyField = requireText(keyField, 'keyField');
  const byKey = new Map();
  let duplicateCount = 0;

  for (const row of requireArray(rows, 'rows')) {
    requirePlainObject(row, 'row');
    const keyValue = requireText(row?.[normalizedKeyField], normalizedKeyField);
    if (byKey.has(keyValue)) duplicateCount += 1;
    byKey.set(keyValue, row);
  }

  return Object.freeze({
    rows: Object.freeze([...byKey.values()]),
    duplicateCount,
  });
}

/**
 * เปรียบเทียบเฉพาะ Field ที่ Incoming ต้องการเขียน
 * Field อื่นที่มีอยู่ในปลายทาง เช่น Formula หรือ Audit field จะไม่ทำให้เกิด Update ปลอม
 */
export function hasChangedFields(existingFields, incomingFields) {
  requirePlainObject(existingFields, 'existingFields');
  requirePlainObject(incomingFields, 'incomingFields');

  for (const [fieldName, incomingValue] of Object.entries(incomingFields)) {
    const existingValue = existingFields[fieldName];
    if (!deepEqual(normalizeComparable(existingValue), normalizeComparable(incomingValue))) {
      return true;
    }
  }

  return false;
}

/**
 * เลือกวิธีอ่าน Record ปลายทางที่ประหยัดที่สุด
 * Repository ของ Lark ใช้ Search Records ตาม Key; Repository อื่นยัง fallback ไป listAll ได้
 */
async function readExistingRecords(input) {
  if (typeof input.repository.listByFieldValues === 'function') {
    const records = await input.repository.listByFieldValues(
      input.tableId,
      input.keyField,
      input.keyValues,
    );
    return Object.freeze({ records: requireArray(records, 'existingRecords'), strategy: 'filtered_keys' });
  }

  const records = await input.repository.listAll(input.tableId);
  return Object.freeze({ records: requireArray(records, 'existingRecords'), strategy: 'full_table_scan' });
}

/**
 * ให้ Repository แปลงค่าจาก Storage เป็นรูปแบบเปรียบเทียบเดียวกับ Payload ที่จะเขียน
 * เช่น URL/Rich text ของ Lark ซึ่งรูปแบบตอนอ่านและเขียนไม่เหมือนกัน
 */
async function normalizeExistingRecords(input) {
  if (typeof input.repository.prepareExistingRecords !== 'function') {
    return input.records;
  }

  return input.repository.prepareExistingRecords(input.tableId, input.records, {
    incomingFieldNames: input.incomingFieldNames,
  });
}

/** สร้าง Set ของ Field ที่ Incoming ใช้จริงเพื่อลดงาน Normalize Record ปลายทาง */
function collectIncomingFieldNames(rows) {
  const names = new Set();
  for (const row of rows) {
    for (const fieldName of Object.keys(row)) names.add(fieldName);
  }
  return Object.freeze([...names]);
}

/** สร้าง Index ของ Record ปลายทางและตรวจ Stable Key ซ้ำ */
function buildExistingIndex(records, keyField, duplicatePolicy) {
  const index = new Map();
  const duplicates = [];

  for (const record of requireArray(records, 'existingRecords')) {
    const keyValue = optionalText(record?.fields?.[keyField]);
    if (!keyValue) continue;

    if (index.has(keyValue)) {
      duplicates.push(keyValue);
      if (duplicatePolicy === 'first') continue;
    }

    index.set(keyValue, record);
  }

  if (duplicates.length > 0 && duplicatePolicy === 'error') {
    const unique = [...new Set(duplicates)];
    throw new Error(
      `Destination table contains duplicate ${keyField} values: ${unique.slice(0, 10).join(', ')}`,
    );
  }

  return index;
}

/** สร้าง Immutable Plan ที่เก็บ Repository ภายในเพื่อ Execute ภายหลัง */
function createPlan(input) {
  return Object.freeze({
    [PLAN_MARKER]: true,
    repository: input.repository,
    tableId: input.tableId,
    keyField: input.keyField,
    createRows: Object.freeze([...input.createRows]),
    updateRows: Object.freeze([...input.updateRows]),
    skipped: input.skipped,
    duplicateInputRows: input.duplicateInputRows,
    inputRows: input.inputRows,
    existingRecordsRead: input.existingRecordsRead,
    existingReadStrategy: input.existingReadStrategy,
  });
}

/** ยืนยันว่าค่าที่ได้รับมาจาก planByKey ของ Engine จริง */
function requirePlan(value) {
  if (!value || value[PLAN_MARKER] !== true) {
    throw new TypeError('TableSyncEngine requires a valid sync plan');
  }
  return value;
}

/** Normalize Object/Array แบบเรียง Key เพื่อให้เปรียบเทียบผลลัพธ์ได้คงที่ */
function normalizeComparable(value) {
  if (Array.isArray(value)) return value.map(normalizeComparable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeComparable(nested)]),
    );
  }
  return value;
}

/** Deep equality ที่ไม่ใช้ JSON.stringify เพื่อเลี่ยงปัญหาลำดับ Key */
function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }

  if (typeof left === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
  }

  return false;
}

/** ตรวจ Contract ขั้นต่ำของ Repository โดยอนุญาต filtered read เป็นทางเลือก */
function requireRepository(repository) {
  for (const method of ['prepareRows', 'createMany', 'updateMany']) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`TableSyncEngine requires repository.${method}`);
    }
  }

  if (typeof repository?.listByFieldValues !== 'function' && typeof repository?.listAll !== 'function') {
    throw new TypeError('TableSyncEngine requires repository.listByFieldValues or repository.listAll');
  }

  return repository;
}

/** อ่าน Callback Progress โดย fallback เป็น No-op */
function readProgress(value) {
  return typeof value === 'function' ? value : () => undefined;
}

/** บังคับค่า Array สำหรับ Input และผลลัพธ์จาก Repository */
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`TableSyncEngine requires array ${fieldName}`);
  return value;
}

/** บังคับ Plain Object เพื่อป้องกัน Array/null หลุดเข้า Diff */
function requirePlainObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`TableSyncEngine requires object ${fieldName}`);
  }
  return value;
}

/** อ่านข้อความที่ไม่จำเป็นและคืน null เมื่อว่าง */
function optionalText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/** บังคับ Stable Key/Table ID/Field name เป็นข้อความที่ไม่ว่าง */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`TableSyncEngine requires ${fieldName}`);
  }
  return value.trim();
}

/** ตรวจนโยบาย Duplicate ที่ Engine รองรับ */
function readDuplicatePolicy(value) {
  if (value !== 'error' && value !== 'first') {
    throw new TypeError('existingDuplicatePolicy must be error or first');
  }
  return value;
}

/** ตรวจจำนวน Record ที่ Repository รายงานกลับมา */
function readResultCount(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`Repository ${fieldName} result must be a non-negative integer`);
  }
  return number;
}


/** ตรวจว่า Repository ยืนยันจำนวนที่เขียนครบตาม Plan เพื่อไม่รายงาน Success แบบ Partial เงียบ ๆ */
function assertExpectedWriteCount(actual, expected, operation, tableId) {
  if (actual !== expected) {
    throw new Error(
      `Repository ${operation} count mismatch for table ${tableId}: expected ${expected}, received ${actual}`,
    );
  }
}

/** Freeze ผลลัพธ์เพื่อป้องกันแก้ค่าหลังส่งออก */
function freezeResult(result) {
  return Object.freeze(result);
}
