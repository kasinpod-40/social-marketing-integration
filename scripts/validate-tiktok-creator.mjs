import { validateLarkLiveSync } from '../packages/application/src/use-cases/validate-lark-live-sync.js';
import {
  createLocalLarkRuntime,
  printJson,
  readMetricDate,
  readTikTokRuntime,
} from './lib/lark-runtime.js';

/** โหลด Runtime และ Table ที่ TikTok validation ต้องใช้ */
const runtime = await createLocalLarkRuntime([
  'rawTikTokCreatorVideos',
  'mktClassificationDictionary',
  'mktContent',
  'mktContentDaily',
]);
const tiktok = readTikTokRuntime(runtime.runtimeConfig);

/** ใช้ Prepare path เดียวกับ Write แต่ไม่ Execute Plan */
const result = await validateLarkLiveSync({
  repository: runtime.repository,
  syncEngine: runtime.syncEngine,
  accountId: tiktok.accountKey,
  sourceHandle: tiktok.sourceHandle,
  metricDate: readMetricDate(runtime.env),
  sampleLimit: Number(runtime.env.SAMPLE_LIMIT ?? 5),
  tables: {
    rawTikTokCreatorVideos: runtime.tables.rawTikTokCreatorVideos,
    mktClassificationDictionary: runtime.tables.mktClassificationDictionary,
    mktContent: runtime.tables.mktContent,
    mktContentDaily: runtime.tables.mktContentDaily,
  },
});

/** แสดงผล Dry run และคืน Exit code 1 เมื่อยังไม่พร้อมเขียน */
printJson(result);
if (!result.ok) process.exitCode = 1;
