import { loadClassificationDictionaryAnalysis } from './load-classification-dictionary.js';
import { normalizeTikTokCreatorVideoBatch } from './normalize-tiktok-creator-video-batch.js';
import { readLarkText } from '../../../connectors/src/shared/lark-cell-value.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';
import { toEpochMilliseconds } from '../../../shared/src/date/date-time.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/**
 * เตรียมข้อมูลและ Sync Plan ของ TikTok Creator โดยยังไม่เขียน Lark
 *
 * ฟังก์ชันนี้เป็นเส้นทางกลางร่วมกันระหว่าง validate:tiktok และ sync:tiktok
 * เพื่อให้ Dry run ทดสอบ Schema, Diff, Identity conflict และ Stable key แบบเดียวกับ Write path จริง
 */
export async function prepareTikTokCreatorLarkSync(input) {
  const repository = requireRepository(input?.repository);
  const syncEngine = requireSyncEngine(input?.syncEngine);
  const tables = requireTables(input?.tables);
  const accountId = requireText(input?.accountId, 'accountId');
  const expectedSourceHandle = normalizeHandle(requireText(input?.sourceHandle, 'sourceHandle'));
  const metricDate = requireDateOnly(input?.metricDate, { label: 'metricDate' });
  const progress = readProgress(input?.onProgress);

  progress({ stage: 'loading_source_data' });
  const [rawRecords, dictionaryAnalysis] = await Promise.all([
    repository.listAll(tables.rawTikTokCreatorVideos),
    loadClassificationDictionaryAnalysis({
      repository,
      tableId: tables.mktClassificationDictionary,
    }),
  ]);

  const dictionaryRules = dictionaryAnalysis.rules;
  const rawRows = rawRecords.map((record) => record?.fields ?? {});
  progress({
    stage: 'normalizing',
    rawRecords: rawRows.length,
    classificationRules: dictionaryRules.length,
  });

  const normalized = normalizeTikTokCreatorVideoBatch({
    rawRows,
    accountId,
    metricDate,
    dictionaryRules,
  });
  const sourceIdentity = evaluateSourceIdentity(expectedSourceHandle, normalized.sourceHandles);

  progress({
    stage: 'preparing_destination_plans',
    contentRows: normalized.contentRows.length,
    dailySnapshotRows: normalized.dailySnapshotRows.length,
  });

  const [contentPlan, dailyPlan, contentConflicts, dailyConflicts] = await Promise.all([
    syncEngine.planByKey({
      repository,
      tableId: tables.mktContent,
      keyField: 'content_key',
      rows: normalized.contentRows,
      onProgress: (event) => progress({ scope: 'content', ...event }),
    }),
    syncEngine.planByKey({
      repository,
      tableId: tables.mktContentDaily,
      keyField: 'content_daily_key',
      rows: normalized.dailySnapshotRows,
      onProgress: (event) => progress({ scope: 'daily_snapshots', ...event }),
    }),
    findAccountIdentityConflicts({
      repository,
      tableId: tables.mktContent,
      tableRole: 'content',
      stableKeyField: 'content_key',
      rows: normalized.contentRows,
    }),
    findAccountIdentityConflicts({
      repository,
      tableId: tables.mktContentDaily,
      tableRole: 'daily_snapshot',
      stableKeyField: 'content_daily_key',
      metricDateField: 'metric_date',
      rows: normalized.dailySnapshotRows,
    }),
  ]);
  const accountConflicts = Object.freeze([...contentConflicts, ...dailyConflicts]);
  const reconciliation = analyzeDestinationConsistency(contentPlan, dailyPlan);

  const issues = buildReadinessIssues({
    rawCount: rawRows.length,
    dictionaryRuleCount: dictionaryRules.length,
    normalized,
    sourceIdentity,
    accountConflicts,
    invalidDictionaryRows: dictionaryAnalysis.invalidRows,
  });
  const warnings = buildWarnings({ normalized });
  const readyToWrite = issues.length === 0;

  progress({
    stage: 'destination_plans_ready',
    readyToWrite,
    issues: issues.length,
    accountConflicts: accountConflicts.length,
  });

  return Object.freeze({
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    accountId,
    metricDate,
    rawRecords: rawRows.length,
    classificationRules: dictionaryRules.length,
    classificationDictionary: Object.freeze({
      totalRows: dictionaryAnalysis.totalRows,
      disabledRows: dictionaryAnalysis.disabledRows,
      invalidRows: dictionaryAnalysis.invalidRows,
    }),
    normalized,
    sourceIdentity,
    accountConflicts: Object.freeze(accountConflicts),
    issues: Object.freeze(issues),
    warnings: Object.freeze(warnings),
    reconciliation,
    readyToWrite,
    plans: Object.freeze({ content: contentPlan, dailySnapshots: dailyPlan }),
  });
}

/**
 * ตรวจความสอดคล้องระหว่าง Master content และ Daily snapshot จาก Plan ก่อนเขียน
 * Stable key ทำให้รอบถัดไปสามารถเติมเฉพาะฝั่งที่ขาดได้โดยไม่สร้างข้อมูลซ้ำ
 */
function analyzeDestinationConsistency(contentPlan, dailyPlan) {
  const contentCreateIds = new Set(contentPlan.createRows.map(readExternalContentId));
  const dailyCreateIds = new Set(dailyPlan.createRows.map(readExternalContentId));
  const allIds = new Set([...contentCreateIds, ...dailyCreateIds]);
  const missingContentIds = [];
  const missingDailySnapshotIds = [];

  for (const externalContentId of allIds) {
    const contentMissing = contentCreateIds.has(externalContentId);
    const dailyMissing = dailyCreateIds.has(externalContentId);
    if (contentMissing && !dailyMissing) missingContentIds.push(externalContentId);
    if (!contentMissing && dailyMissing) missingDailySnapshotIds.push(externalContentId);
  }

  const required = missingContentIds.length > 0 || missingDailySnapshotIds.length > 0;
  return Object.freeze({
    required,
    status: required ? 'recovery_required' : 'consistent',
    missingContentRows: missingContentIds.length,
    missingDailySnapshotRows: missingDailySnapshotIds.length,
    missingContentIds: Object.freeze(missingContentIds.slice(0, 20)),
    missingDailySnapshotIds: Object.freeze(missingDailySnapshotIds.slice(0, 20)),
  });
}

function readExternalContentId(row) {
  return requireText(row?.external_content_id, 'external_content_id');
}

/**
 * หยุด Write ด้วย Permanent error เมื่อผล Prepare ยังไม่พร้อม
 * Queue จะ Ack และแจ้งเตือนแทนการ Retry loop เพราะข้อมูล/Config ต้องถูกแก้ก่อน
 */
export function assertTikTokSyncReady(prepared) {
  if (prepared?.readyToWrite === true) return prepared;
  const issues = Array.isArray(prepared?.issues) ? prepared.issues : ['Unknown TikTok sync readiness error'];
  throw permanentError(`TikTok sync is not ready: ${issues.join(' | ')}`, {
    code: 'TIKTOK_SYNC_NOT_READY',
    details: {
      issueCount: issues.length,
      accountId: prepared?.accountId ?? null,
      metricDate: prepared?.metricDate ?? null,
    },
  });
}

/**
 * ประเมิน Handle แบบเข้มงวด: ต้องตรวจพบหนึ่งบัญชีและต้องตรงกับ Config เท่านั้น
 */
export function evaluateSourceIdentity(expectedSourceHandle, sourceHandles) {
  const expected = normalizeHandle(requireText(expectedSourceHandle, 'expectedSourceHandle'));
  const handles = Array.isArray(sourceHandles)
    ? [...new Set(sourceHandles.map(normalizeHandle).filter(Boolean))].sort()
    : [];
  const ok = handles.length === 1 && handles[0] === expected;

  return Object.freeze({
    ok,
    expectedHandle: expected,
    detectedHandles: Object.freeze(handles),
  });
}

/**
 * ตรวจ External content เดียวกันที่เคยผูกกับ account_id อื่น
 * ป้องกันข้อมูล Dev ถูกสร้างซ้ำในชื่อ Production หรือกลับกัน
 */
async function findAccountIdentityConflicts(input) {
  if (input.rows.length === 0) return [];
  const stableKeyField = requireText(input.stableKeyField, 'stableKeyField');
  const metricDateField = input.metricDateField ?? null;
  const externalIds = [...new Set(input.rows.map((row) => requireText(row.external_content_id, 'external_content_id')))];
  const existingRecords = typeof input.repository.listByFieldValues === 'function'
    ? await input.repository.listByFieldValues(input.tableId, 'external_content_id', externalIds)
    : await input.repository.listAll(input.tableId);
  const incomingByBaseIdentity = new Map();
  const incomingByFullIdentity = new Map();

  for (const row of input.rows) {
    const baseIdentity = createIdentity(row.platform, row.external_content_id);
    const incoming = Object.freeze({
      accountId: requireText(row.account_id, 'account_id'),
      stableKey: requireText(row[stableKeyField], stableKeyField),
      metricDate: metricDateField ? toEpochMilliseconds(row[metricDateField], { label: metricDateField }) : null,
    });
    incomingByBaseIdentity.set(baseIdentity, incoming);
    incomingByFullIdentity.set(createDestinationIdentity({
      platform: row.platform,
      externalContentId: row.external_content_id,
      metricDate: incoming.metricDate,
    }), incoming);
  }

  const conflicts = [];
  for (const record of existingRecords) {
    const fields = record?.fields ?? {};
    const platform = readLarkText(fields.platform, { allowNull: true, label: 'platform' });
    const externalContentId = readLarkText(fields.external_content_id, {
      allowNull: true,
      label: 'external_content_id',
    });
    if (!platform || !externalContentId) continue;

    const baseIdentity = createIdentity(platform, externalContentId);
    const baseIncoming = incomingByBaseIdentity.get(baseIdentity);
    if (!baseIncoming) continue;

    const existingAccountId = readLarkText(fields.account_id, { allowNull: true, label: 'account_id' });
    if (existingAccountId !== baseIncoming.accountId) {
      conflicts.push(createDestinationConflict({
        input,
        record,
        platform,
        externalContentId,
        metricDate: null,
        existingAccountId,
        incoming: baseIncoming,
        existingStableKey: readLarkText(fields[stableKeyField], { allowNull: true, label: stableKeyField }),
        conflictType: 'account_mismatch',
      }));
      continue;
    }

    let metricDate = null;
    if (metricDateField) {
      try {
        metricDate = toEpochMilliseconds(fields[metricDateField], {
          allowNull: true,
          label: metricDateField,
        });
      } catch {
        // วันที่เดิมที่อ่านไม่ได้ไม่สามารถยืนยันว่าเป็น Snapshot เดียวกับ Incoming จึงไม่เดา
        continue;
      }
      if (metricDate === null) continue;
    }

    const incoming = incomingByFullIdentity.get(createDestinationIdentity({
      platform,
      externalContentId,
      metricDate,
    }));
    if (!incoming) continue;

    const existingStableKey = readLarkText(fields[stableKeyField], {
      allowNull: true,
      label: stableKeyField,
    });
    if (existingStableKey === incoming.stableKey) continue;

    conflicts.push(createDestinationConflict({
      input,
      record,
      platform,
      externalContentId,
      metricDate,
      existingAccountId,
      incoming,
      existingStableKey,
      conflictType: 'stable_key_mismatch',
    }));
  }

  return conflicts;
}

/** สร้าง Conflict payload รูปแบบเดียวกันสำหรับ Account และ Stable-key mismatch */
function createDestinationConflict(input) {
  return Object.freeze({
    conflictType: input.conflictType,
    tableId: input.input.tableId,
    tableRole: input.input.tableRole ?? 'unknown',
    recordId: input.record?.recordId ?? null,
    platform: input.platform.toLowerCase(),
    externalContentId: input.externalContentId,
    metricDate: input.metricDate,
    existingAccountId: input.existingAccountId,
    incomingAccountId: input.incoming.accountId,
    existingStableKey: input.existingStableKey,
    incomingStableKey: input.incoming.stableKey,
  });
}


/** สร้าง Identity ของ Master หรือ Daily Snapshot โดยรวมวันที่เมื่อ Table มีหลายวันต่อ Content */
function createDestinationIdentity(input) {
  const base = createIdentity(input.platform, input.externalContentId);
  return input.metricDate === null || input.metricDate === undefined
    ? base
    : `${base}::${toEpochMilliseconds(input.metricDate, { label: 'metricDate' })}`;
}


/** สร้างรายการปัญหาที่ทำให้ยังเขียนไม่ได้ */
function buildReadinessIssues(input) {
  const issues = [];
  if (input.rawCount === 0) issues.push('RAW_TikTok_Creator_Videos has no records');
  if (input.dictionaryRuleCount === 0) issues.push('MKT_Classification_Dictionary has no enabled valid rules');
  if (input.invalidDictionaryRows.length > 0) {
    issues.push(`${input.invalidDictionaryRows.length} enabled classification dictionary row(s) are invalid`);
  }
  if (input.normalized.contentRows.length === 0) issues.push('No valid MKT_Content rows were produced');
  if (input.normalized.dailySnapshotRows.length === 0) issues.push('No valid MKT_Content_Daily rows were produced');
  if (input.normalized.skippedRows.length > 0) {
    issues.push(`${input.normalized.skippedRows.length} raw row(s) failed normalization`);
  }
  if (input.normalized.duplicateContentRows > 0 || input.normalized.duplicateDailyRows > 0) {
    issues.push(
      `${Math.max(input.normalized.duplicateContentRows, input.normalized.duplicateDailyRows)} duplicate RAW content identity row(s) require cleanup before sync`,
    );
  }
  if (!input.sourceIdentity.ok) {
    const detected = input.sourceIdentity.detectedHandles.map((value) => `@${value}`).join(', ') || 'none';
    issues.push(`RAW TikTok source handle mismatch: expected @${input.sourceIdentity.expectedHandle}, detected ${detected}`);
  }
  if (input.accountConflicts.length > 0) {
    issues.push(`${input.accountConflicts.length} destination identity conflict(s) found in destination tables`);
  }
  return issues;
}

/** สร้างคำเตือนที่ไม่บล็อก Write เช่น Input ซ้ำซึ่งถูก Deduplicate แล้ว */
function buildWarnings() {
  return [];
}

/** สร้าง Identity กลางสำหรับเทียบ Platform + External content ID */
function createIdentity(platform, externalContentId) {
  return `${requireText(platform, 'platform').toLowerCase()}::${requireText(externalContentId, 'externalContentId')}`;
}

/** ตรวจ Repository contract ที่ใช้ทั้ง Read, Search และ Plan */
function requireRepository(repository) {
  for (const method of ['listAll', 'prepareRows', 'createMany', 'updateMany']) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`prepareTikTokCreatorLarkSync requires repository.${method}`);
    }
  }
  return repository;
}

/** ตรวจ Sync Engine contract แบบ Plan/Execute รุ่นใหม่ */
function requireSyncEngine(syncEngine) {
  for (const method of ['planByKey', 'executePlan']) {
    if (typeof syncEngine?.[method] !== 'function') {
      throw new TypeError(`prepareTikTokCreatorLarkSync requires syncEngine.${method}`);
    }
  }
  return syncEngine;
}

/** ตรวจ Table IDs ที่ Flow TikTok ต้องใช้ครบ */
function requireTables(tables) {
  const required = [
    'rawTikTokCreatorVideos',
    'mktContent',
    'mktContentDaily',
    'mktClassificationDictionary',
  ];
  return Object.freeze(Object.fromEntries(
    required.map((key) => [key, requireText(tables?.[key], `tables.${key}`)]),
  ));
}

/** Normalize TikTok handle โดยตัด @ และใช้ตัวพิมพ์เล็ก */
function normalizeHandle(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/^@/u, '').trim().toLowerCase();
}

/** อ่าน Progress callback โดย fallback เป็น No-op */
function readProgress(value) {
  return typeof value === 'function' ? value : () => undefined;
}

/** บังคับข้อความที่ไม่ว่าง */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`TikTok sync requires ${fieldName}`, {
      code: 'TIKTOK_INVALID_INPUT',
      details: { fieldName },
    });
  }
  return value.trim();
}
