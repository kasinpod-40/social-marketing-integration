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
import { isRetryableError, permanentError } from '../../../packages/shared/src/errors/runtime-error.js';


const JOB_TYPES = Object.freeze({
  TIKTOK_CREATOR_NATIVE_SYNC: 'tiktok.creator.native.sync',
  METRIC_DEFINITIONS_SEED: 'metric.definitions.seed',
  TIKTOK_CREATOR_NATIVE_VALIDATE: 'tiktok.creator.native.validate',
});

/**
 * Cloudflare Worker สำหรับ Scheduled jobs และ Queue jobs ของการ Sync
 */
export default {
  /**
   * Scheduled heartbeat ยังไม่เขียน Lark; ใช้ตรวจว่า Cron trigger ทำงานและเวลา Runtime ถูกต้อง
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
   * - Error ชั่วคราวที่ประกาศ retryable=true เท่านั้นจึง Retry
   * - Config/Schema/Job type ผิดจะ Ack และ Log เป็น Permanent failure เพื่อไม่วน Retry
   */
  async queue(batch, env) {
    // แชร์ Runtime ภายใน Queue batch เดียวเพื่อใช้ Token/Schema cache ร่วมกัน
    // แต่สร้างแบบ Lazy เพื่อไม่โหลด Secret หรือเรียก Lark สำหรับ Job type ที่ไม่รองรับ
    let runtime = null;
    const getRuntime = () => {
      runtime ??= createRuntime(env);
      return runtime;
    };

    for (const message of batch.messages) {
      let job = null;
      try {
        job = normalizeQueueMessage(message);
        const result = await processJob({ job, env, getRuntime });
        logQueueResult({
          ok: true,
          messageId: message.id,
          type: job.body?.type,
          result: summarizeJobResult(result),
        });
        message.ack();
      } catch (error) {
        const retryable = isRetryableError(error);
        logQueueResult({
          ok: false,
          messageId: message.id,
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

/** Normalize Queue message โดยไม่แก้ body ต้นฉบับ */
function normalizeQueueMessage(message) {
  return Object.freeze({
    id: message?.id ?? null,
    body: parseQueueBody(message?.body),
    receivedAt: new Date().toISOString(),
  });
}

/** รองรับ Queue body ที่เป็น Object หรือ JSON string และปฏิเสธ Shape อื่นแบบ Permanent */
function parseQueueBody(value) {
  let body = value ?? {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (cause) {
      throw permanentError('Sync queue message body is not valid JSON', {
        code: 'INVALID_SYNC_JOB',
        cause,
      });
    }
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw permanentError('Sync queue message body must be an object', {
      code: 'INVALID_SYNC_JOB',
    });
  }
  return Object.freeze({ ...body });
}

/**
 * Route Job type ไปยัง Use case ที่ถูกต้อง และสร้าง Lark runtime เฉพาะ Job ที่รองรับแล้ว
 */
async function processJob(input) {
  const job = input.job;
  const type = requireText(job?.body?.type, `job.type:${job?.id ?? 'unknown'}`);

  if (!Object.values(JOB_TYPES).includes(type)) {
    throw permanentError(`Unsupported sync job type: ${type}`, {
      code: 'UNSUPPORTED_SYNC_JOB',
      details: { type },
    });
  }

  // สร้าง Runtime หลังผ่าน Job type validation แล้ว และแชร์ภายใน Queue batch เดียว
  const runtime = input.getRuntime();

  if (type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC) {
    const runtimeConfig = runtime.runtimeConfig;
    const tableIds = readLarkTableIdsFromEnv(input.env, [
      'rawTikTokCreatorVideos',
      'mktContent',
      'mktContentDaily',
      'mktClassificationDictionary',
    ]);

    return syncTikTokCreatorNativeToLark({
      repository: runtime.repository,
      syncEngine: runtime.syncEngine,
      accountId: runtimeConfig.tiktok.accountKey,
      sourceHandle: runtimeConfig.tiktok.sourceHandle,
      metricDate: readMetricDate(job.body?.metricDate, input.env),
      tables: {
        rawTikTokCreatorVideos: tableIds.rawTikTokCreatorVideos,
        mktContent: tableIds.mktContent,
        mktContentDaily: tableIds.mktContentDaily,
        mktClassificationDictionary: tableIds.mktClassificationDictionary,
      },
    });
  }

  if (type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_VALIDATE) {
    const runtimeConfig = runtime.runtimeConfig;
    const tableIds = readLarkTableIdsFromEnv(input.env, [
      'rawTikTokCreatorVideos',
      'mktClassificationDictionary',
      'mktContent',
      'mktContentDaily',
    ]);

    return validateLarkLiveSync({
      repository: runtime.repository,
      syncEngine: runtime.syncEngine,
      accountId: runtimeConfig.tiktok.accountKey,
      sourceHandle: runtimeConfig.tiktok.sourceHandle,
      metricDate: readMetricDate(job.body?.metricDate, input.env),
      sampleLimit: job.body?.sampleLimit,
      tables: {
        rawTikTokCreatorVideos: tableIds.rawTikTokCreatorVideos,
        mktClassificationDictionary: tableIds.mktClassificationDictionary,
        mktContent: tableIds.mktContent,
        mktContentDaily: tableIds.mktContentDaily,
      },
    });
  }

  const tableIds = readLarkTableIdsFromEnv(input.env, ['mktMetricDefinitions']);
  return seedMetricDefinitions({
    repository: runtime.repository,
    syncEngine: runtime.syncEngine,
    tableId: tableIds.mktMetricDefinitions,
  });
}

/** สร้าง Client/Repository/Engine หนึ่งชุดต่อ Queue event เพื่อแชร์ Token และ Schema cache ภายใน Batch */
function createRuntime(env) {
  // ตรวจ Environment/Profile ก่อนสร้าง Infrastructure เพื่อให้ทุก Job รวมถึง Metric seed
  // อยู่ภายใต้ Dev/Production ownership contract เดียวกันและได้ Error code ที่ชัดเจน
  const runtimeConfig = loadCustomerRuntimeConfig(env);
  const client = createLarkBitableClientFromEnv(env);
  return Object.freeze({
    runtimeConfig,
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

function summarizeWriteResult(value) {
  if (value === null || typeof value !== 'object') return null;
  return Object.freeze({
    created: value.created ?? value.createRows ?? null,
    updated: value.updated ?? value.updateRows ?? null,
    skipped: value.skipped ?? null,
    duplicateInputRows: value.duplicateInputRows ?? null,
  });
}

/** บังคับข้อความ Job type ที่ไม่ว่าง */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`Sync worker requires ${fieldName}`, {
      code: 'INVALID_SYNC_JOB',
      details: { fieldName },
    });
  }
  return value.trim();
}
