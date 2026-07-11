import { syncTikTokCreatorNativeToLark } from '../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import { createLocalLarkRuntime, printJson, readAccountId, readMetricDate } from './lib/lark-runtime.js';

if (process.env.CONFIRM_WRITE !== 'YES') {
  throw new Error('Refusing to write to Lark. Run with CONFIRM_WRITE=YES npm run sync:tiktok');
}

const runtime = await createLocalLarkRuntime([
  'rawTikTokCreatorVideos',
  'mktContent',
  'mktContentDaily',
  'mktClassificationDictionary',
]);

console.error(`[${new Date().toISOString()}] TikTok sync started`);
const result = await syncTikTokCreatorNativeToLark({
  repository: runtime.repository,
  syncEngine: runtime.syncEngine,
  accountId: readAccountId(runtime.env),
  metricDate: readMetricDate(runtime.env),
  onProgress: (event) => console.error(`[${new Date().toISOString()}] ${JSON.stringify(event)}`),
  tables: {
    rawTikTokCreatorVideos: runtime.tables.rawTikTokCreatorVideos,
    mktContent: runtime.tables.mktContent,
    mktContentDaily: runtime.tables.mktContentDaily,
    mktClassificationDictionary: runtime.tables.mktClassificationDictionary,
  },
});

console.error(`[${new Date().toISOString()}] TikTok sync completed`);
printJson(result);
