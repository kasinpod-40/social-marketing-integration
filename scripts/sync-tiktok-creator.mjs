import { syncTikTokCreatorNativeToLark } from '../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import { runReliableSync } from '../packages/reliability/src/reliable-sync-runner.js';
import { LarkReliabilityStore } from '../packages/reliability/src/lark-reliability-store.js';
import { CompositeReliabilityStore } from '../packages/reliability/src/composite-reliability-store.js';
import { FileLeaseLockManager } from './lib/file-lease-lock-manager.js';
import {
  createLocalLarkRuntime,
  printJson,
  readMetricDate,
  readTikTokRuntime,
} from './lib/lark-runtime.js';

await main().catch((error) => {
  const payload = {
    ok: false,
    status: error?.code === 'SYNC_LOCK_BUSY' ? 'skipped' : 'failed',
    code: error?.code ?? 'UNHANDLED_SYNC_ERROR',
    retryable: error?.retryable === true,
    syncRunId: error?.syncRunId ?? null,
    message: error instanceof Error ? error.message : String(error),
  };
  printJson(payload);
  process.exitCode = error?.code === 'SYNC_LOCK_BUSY' ? 0 : 1;
});

async function main() {
  if (process.env.CONFIRM_WRITE !== 'YES') {
    throw new Error('Refusing to write to Lark. Run with CONFIRM_WRITE=YES npm run sync:tiktok');
  }

  const logEvent = (event) => console.error(
    `[${new Date().toISOString()}] ${JSON.stringify(event)}`,
  );

  const runtime = await createLocalLarkRuntime([
    'rawTikTokCreatorVideos',
    'mktContent',
    'mktContentDaily',
    'mktClassificationDictionary',
    'mktSyncLog',
    'mktSystemAlerts',
  ], {
    onRequest: (event) => logEvent({ scope: 'lark', ...event }),
  });
  const tiktok = readTikTokRuntime(runtime.runtimeConfig);

  const larkReliabilityStore = new LarkReliabilityStore({
    repository: runtime.repository,
    syncEngine: runtime.syncEngine,
    tables: {
      syncLog: runtime.tables.mktSyncLog,
      systemAlerts: runtime.tables.mktSystemAlerts,
    },
  });
  // Local ไม่มี D1 จึงใช้ Lark เป็น Primary; Cloudflare ใช้ D1 Primary และ Lark Mirror
  const reliabilityStore = new CompositeReliabilityStore({
    primary: larkReliabilityStore,
    mirrors: [],
  });
  const lockManager = new FileLeaseLockManager({
    directory: runtime.env.MKT_LOCAL_LOCK_DIR || '.mkt-locks',
  });

  logEvent({
    stage: 'tiktok_sync_started',
    environment: runtime.runtimeConfig.environment,
    profile: runtime.runtimeConfig.profileKey,
    accountKey: tiktok.accountKey,
    sourceHandle: tiktok.sourceHandle,
  });

  const result = await runReliableSync({
    store: reliabilityStore,
    lockManager,
    customerProfile: runtime.runtimeConfig.profileKey,
    accountKey: tiktok.accountKey,
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    syncType: 'native_import',
    leaseMs: readPositiveInteger(runtime.env.MKT_SYNC_LOCK_LEASE_MS, 600_000),
    renewIntervalMs: readPositiveInteger(runtime.env.MKT_SYNC_LOCK_RENEW_INTERVAL_MS, 120_000),
    alertOnRetryableFailure: true,
    onReliabilityError: (event) => logEvent({ scope: 'reliability', ...event }),
    execute: ({ syncRunId, assertLockActive }) => syncTikTokCreatorNativeToLark({
      syncRunId,
      assertLockActive,
      repository: runtime.repository,
      syncEngine: runtime.syncEngine,
      accountId: tiktok.accountKey,
      sourceHandle: tiktok.sourceHandle,
      metricDate: readMetricDate(runtime.env),
      onProgress: logEvent,
      tables: {
        rawTikTokCreatorVideos: runtime.tables.rawTikTokCreatorVideos,
        mktContent: runtime.tables.mktContent,
        mktContentDaily: runtime.tables.mktContentDaily,
        mktClassificationDictionary: runtime.tables.mktClassificationDictionary,
      },
    }),
  });

  logEvent({ stage: 'tiktok_sync_completed', syncRunId: result.syncRunId });
  printJson(result);
}

function readPositiveInteger(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError('Reliability duration must be a positive integer');
  }
  return number;
}
