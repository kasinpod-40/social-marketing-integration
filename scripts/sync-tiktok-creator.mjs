import { syncTikTokCreatorNativeToLark } from '../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import {
  createLocalLarkRuntime,
  printJson,
  readMetricDate,
  readTikTokRuntime,
} from './lib/lark-runtime.js';

/**
 * Write guard ต้องมาจาก Shell เท่านั้น ไม่อ่านจาก .dev.vars
 * ป้องกันผู้ใช้เผลอรัน npm run sync:tiktok แล้วเขียนข้อมูลทันที
 */
if (process.env.CONFIRM_WRITE !== 'YES') {
  throw new Error('Refusing to write to Lark. Run with CONFIRM_WRITE=YES npm run sync:tiktok');
}

/** Structured progress log ส่งไป stderr เพื่อแยกจาก JSON result บน stdout */
const logEvent = (event) => console.error(
  `[${new Date().toISOString()}] ${JSON.stringify(event)}`,
);

/** โหลด Runtime และผูก Request tracing ที่ Mask App token แล้ว */
const runtime = await createLocalLarkRuntime([
  'rawTikTokCreatorVideos',
  'mktContent',
  'mktContentDaily',
  'mktClassificationDictionary',
], {
  onRequest: (event) => logEvent({ scope: 'lark', ...event }),
});
const tiktok = readTikTokRuntime(runtime.runtimeConfig);

/** แสดง Profile ที่กำลังใช้โดยไม่แสดง Secret */
logEvent({
  stage: 'tiktok_sync_started',
  environment: runtime.runtimeConfig.environment,
  profile: runtime.runtimeConfig.profileKey,
  accountKey: tiktok.accountKey,
  sourceHandle: tiktok.sourceHandle,
});

/** Prepare ทั้งสองตารางก่อน แล้วจึง Execute เมื่อทุก Validation ผ่าน */
const result = await syncTikTokCreatorNativeToLark({
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
});

logEvent({ stage: 'tiktok_sync_completed' });
printJson(result);
