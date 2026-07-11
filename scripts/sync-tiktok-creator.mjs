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

/** Write guard ต้องมาจาก Shell เท่านั้น ไม่อ่านจาก .dev.vars */
if (process.env.CONFIRM_WRITE !== 'YES') {
  throw new Error('Refusing to write to Lark. Run with CONFIRM_WRITE=YES npm run sync:tiktok');
}

const logEvent = (event) => console.error(
  `[${new Date().toISOString()}] ${JSON.stringify(event)}`,
);

/**
 * เพิ่มตาราง Sync Log และ System Alerts เป็น Required table ของ Write path
 * เพื่อให้ทุกการเขียนมี Operational record ก่อนเริ่มแตะตารางธุรกิจ
 */
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
const reliabilityStore = new CompositeReliabilityStore({
  stores: [larkReliabilityStore],
  onStoreError: ({ method, store, error }) => logEvent({
    scope: 'reliability_store',
    stage: 'store_error',
    method,
    store,
    error: error instanceof Error ? error.message : String(error),
  }),
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
  alertOnRetryableFailure: true,
  onReliabilityError: (event) => logEvent({ scope: 'reliability', ...event }),
  execute: ({ syncRunId }) => syncTikTokCreatorNativeToLark({
    syncRunId,
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

function readPositiveInteger(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError('MKT_SYNC_LOCK_LEASE_MS must be a positive integer');
  }
  return number;
}
