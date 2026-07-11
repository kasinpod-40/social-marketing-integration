import { createSyncLogEntry } from '../../../packages/domain/src/entities/sync-log.js';
import { syncTikTokCreatorNativeToLark } from '../../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import { createLarkBitableClientFromEnv } from '../../../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../../../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../../../packages/sync-engine/src/table-sync-engine.js';
import { seedMetricDefinitions } from '../../../packages/application/src/use-cases/seed-metric-definitions.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { validateLarkLiveSync } from '../../../packages/application/src/use-cases/validate-lark-live-sync.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { resolveMetricDate } from '../../../packages/config/src/metric-date-config.js';
import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import {
  JOB_TYPES,
  assertJobImplemented,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { normalizeQueueJobMessage } from '../../../packages/application/src/jobs/queue-job.js';
import { isRetryableError, permanentError } from '../../../packages/shared/src/errors/runtime-error.js';

/** Cloudflare Worker สำหรับ Scheduled jobs และ Queue jobs ของการ Sync */
export default {
  /**
   * Scheduled heartbeat ยังไม่เขียน Lark
   * ใช้ตรวจว่า Cron trigger ทำงานและเวลา Runtime ถูกต้องก่อนเปิด Scheduled sync จริง
   */
  async scheduled(event) {
    const scheduledAt = new Date(event.scheduledTime).toISOString();
    const entry = createSyncLogEntry({
      platform: 'system',
      syncType: 'scheduled-heartbeat',
      status: 'success',
      startedAt: scheduledAt,
      finishedAt: scheduledAt,
      recordsPulled: 0,
      recordsWritten: 0,
    });

    console.log(JSON.stringify(entry));
  },

  /**
   * ประมวลผล Queue แบบเรียงทีละ Message เพื่อลดการยิง Lark พร้อมกัน
   * - Job ที่รู้จักแต่ยังไม่ Implement จะหยุดก่อนโหลด Runtime/Secret
   * - Connector ที่ปิดด้วย Feature flag จะหยุดก่อนสร้าง Lark client
   * - Error ชั่วคราวที่ประกาศ retryable=true เท่านั้นจึง Retry
   */
  async queue(batch, env) {
    let runtimeConfig = null;
    let infrastructure = null;

    // โหลด Customer profile แบบ Lazy เพื่อให้ Unknown/Planned job ไม่แตะ Config หรือ Secret ที่ไม่จำเป็น
    const getRuntimeConfig = () => {
      runtimeConfig ??= loadCustomerRuntimeConfig(env);
      return runtimeConfig;
    };

    // สร้าง Client/Repository/Engine หลัง Job และ Connector ผ่าน Validation แล้วเท่านั้น
    const getInfrastructure = () => {
      infrastructure ??= createInfrastructure(env);
      return infrastructure;
    };

    for (const message of batch.messages) {
      let job = null;
      try {
        job = normalizeQueueJobMessage(message);
        const result = await processJob({
          job,
          env,
          getRuntimeConfig,
          getInfrastructure,
        });
        logQueueResult({
          ok: true,
          messageId: message.id,
          schemaVersion: job.schemaVersion,
          type: job.body?.type,
          result: summarizeJobResult(result),
        });
        message.ack();
      } catch (error) {
        const retryable = isRetryableError(error);
        logQueueResult({
          ok: false,
          messageId: message.id,
          schemaVersion: job?.schemaVersion ?? null,
          type: job?.body?.type ?? null,
          retryable,
          error: error instanceof Error ? error.message : String(error),
          code: error?.code ?? null,
        });

        if (retryable) {
          message.retry();
        } else {
          message.ack();
        }
      }
    }
  },
};

/** Route Job type ไปยัง Use case จริง โดยตรวจ Implementation/Profile/Feature flag ตามลำดับ */
async function processJob(input) {
  const definition = assertJobImplemented(getJobDefinition(input.job?.body?.type));
  const runtimeConfig = input.getRuntimeConfig();
  const connectorConfig = definition.connectorKey
    ? assertConnectorRunnable(runtimeConfig, definition.connectorKey)
    : null;
  const infrastructure = input.getInfrastructure();

  if (definition.type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC) {
    const tableIds = readLarkTableIdsFromEnv(input.env, [
      'rawTikTokCreatorVideos',
      'mktContent',
      'mktContentDaily',
      'mktClassificationDictionary',
    ]);

    return syncTikTokCreatorNativeToLark({
      repository: infrastructure.repository,
      syncEngine: infrastructure.syncEngine,
      accountId: connectorConfig.accountKey,
      sourceHandle: connectorConfig.sourceHandle,
      metricDate: readMetricDate(input.job.body?.metricDate, input.env),
      tables: {
        rawTikTokCreatorVideos: tableIds.rawTikTokCreatorVideos,
        mktContent: tableIds.mktContent,
        mktContentDaily: tableIds.mktContentDaily,
        mktClassificationDictionary: tableIds.mktClassificationDictionary,
      },
    });
  }

  if (definition.type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_VALIDATE) {
    const tableIds = readLarkTableIdsFromEnv(input.env, [
      'rawTikTokCreatorVideos',
      'mktClassificationDictionary',
      'mktContent',
      'mktContentDaily',
    ]);

    return validateLarkLiveSync({
      repository: infrastructure.repository,
      syncEngine: infrastructure.syncEngine,
      accountId: connectorConfig.accountKey,
      sourceHandle: connectorConfig.sourceHandle,
      metricDate: readMetricDate(input.job.body?.metricDate, input.env),
      sampleLimit: input.job.body?.sampleLimit,
      tables: {
        rawTikTokCreatorVideos: tableIds.rawTikTokCreatorVideos,
        mktClassificationDictionary: tableIds.mktClassificationDictionary,
        mktContent: tableIds.mktContent,
        mktContentDaily: tableIds.mktContentDaily,
      },
    });
  }

  if (definition.type === JOB_TYPES.METRIC_DEFINITIONS_SEED) {
    const tableIds = readLarkTableIdsFromEnv(input.env, ['mktMetricDefinitions']);
    return seedMetricDefinitions({
      repository: infrastructure.repository,
      syncEngine: infrastructure.syncEngine,
      tableId: tableIds.mktMetricDefinitions,
    });
  }

  // ป้องกัน Catalog/Router ไม่ตรงกันในอนาคต แม้ definition จะถูกประกาศ active โดยผิดพลาด
  throw permanentError(`Active sync job has no runtime handler: ${definition.type}`, {
    code: 'SYNC_JOB_HANDLER_MISSING',
    details: { type: definition.type },
  });
}

/** สร้าง Infrastructure หนึ่งชุดต่อ Queue event เพื่อแชร์ Token และ Schema cache ภายใน Batch */
function createInfrastructure(env) {
  const client = createLarkBitableClientFromEnv(env);
  return Object.freeze({
    repository: new LarkRecordRepository({ client }),
    syncEngine: new TableSyncEngine(),
  });
}

/** อ่าน Metric date จาก Job ก่อน จาก Environment รองลงมา และวันที่กรุงเทพฯ เป็นค่าเริ่มต้น */
function readMetricDate(jobValue, env) {
  return resolveMetricDate({ env, override: jobValue });
}

/** เขียน Structured log โดยไม่ใส่ Credential หรือ Environment ทั้งก้อน */
function logQueueResult(payload) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    scope: 'sync_worker_queue',
    ...payload,
  }));
}

/** ลดผลลัพธ์ใน Log ให้เหลือเฉพาะ Count/สถานะ ป้องกัน Log โตตามจำนวนแถวข้อมูล */
function summarizeJobResult(result) {
  if (result === null || typeof result !== 'object') return result;
  return Object.freeze({
    platform: result.platform ?? null,
    source: result.source ?? null,
    mode: result.mode ?? null,
    readyToWrite: result.readyToWrite ?? result.ok ?? null,
    rawRecords: result.rawRecords ?? null,
    classificationRules: result.classificationRules ?? null,
    invalidClassificationRuleCount: Array.isArray(result.classificationDictionary?.invalidRows)
      ? result.classificationDictionary.invalidRows.length
      : 0,
    content: summarizeWriteResult(result.content ?? result.syncPlan?.content),
    dailySnapshots: summarizeWriteResult(result.dailySnapshots ?? result.syncPlan?.dailySnapshots),
    issueCount: Array.isArray(result.issues) ? result.issues.length : 0,
    warningCount: Array.isArray(result.warnings) ? result.warnings.length : 0,
    skippedRowCount: Array.isArray(result.skippedRows) ? result.skippedRows.length : 0,
    accountConflictCount: Array.isArray(result.accountConflicts) ? result.accountConflicts.length : 0,
  });
}

/** สรุป Create/Update plan หรือผล Write โดยรองรับ Shape ของ Dry run และ Write run */
function summarizeWriteResult(value) {
  if (value === null || typeof value !== 'object') return null;
  return Object.freeze({
    created: value.created ?? value.createRows ?? null,
    updated: value.updated ?? value.updateRows ?? null,
    skipped: value.skipped ?? null,
    duplicateInputRows: value.duplicateInputRows ?? null,
  });
}
