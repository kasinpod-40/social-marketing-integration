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

const result = await syncTikTokCreatorNativeToLark({
  repository: runtime.repository,
  accountId: readAccountId(runtime.env),
  metricDate: readMetricDate(runtime.env),
  tables: {
    rawTikTokCreatorVideos: runtime.tables.rawTikTokCreatorVideos,
    mktContent: runtime.tables.mktContent,
    mktContentDaily: runtime.tables.mktContentDaily,
    mktClassificationDictionary: runtime.tables.mktClassificationDictionary,
  },
});

printJson(result);
