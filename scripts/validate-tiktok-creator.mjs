import { validateLarkLiveSync } from '../packages/application/src/use-cases/validate-lark-live-sync.js';
import { createLocalLarkRuntime, printJson, readTikTokRuntime, readMetricDate } from './lib/lark-runtime.js';

const runtime = await createLocalLarkRuntime(['rawTikTokCreatorVideos', 'mktClassificationDictionary', 'mktContent', 'mktContentDaily']);
const tiktok = readTikTokRuntime(runtime.runtimeConfig);
const result = await validateLarkLiveSync({
  repository: runtime.repository,
  accountId: tiktok.accountKey,
  sourceHandle: tiktok.sourceHandle,
  metricDate: readMetricDate(runtime.env),
  sampleLimit: Number(process.env.SAMPLE_LIMIT ?? runtime.env.SAMPLE_LIMIT ?? 5),
  tables: {
    rawTikTokCreatorVideos: runtime.tables.rawTikTokCreatorVideos,
    mktClassificationDictionary: runtime.tables.mktClassificationDictionary,
    mktContent: runtime.tables.mktContent,
    mktContentDaily: runtime.tables.mktContentDaily,
  },
});

printJson(result);

if (!result.ok) {
  process.exitCode = 1;
}
