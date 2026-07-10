import { validateLarkLiveSync } from '../packages/application/src/use-cases/validate-lark-live-sync.js';
import { createLocalLarkRuntime, printJson, readAccountId, readMetricDate } from './lib/lark-runtime.js';

const runtime = await createLocalLarkRuntime(['rawTikTokCreatorVideos', 'mktClassificationDictionary']);
const result = await validateLarkLiveSync({
  repository: runtime.repository,
  accountId: readAccountId(runtime.env),
  metricDate: readMetricDate(runtime.env),
  sampleLimit: Number(process.env.SAMPLE_LIMIT ?? runtime.env.SAMPLE_LIMIT ?? 5),
  tables: {
    rawTikTokCreatorVideos: runtime.tables.rawTikTokCreatorVideos,
    mktClassificationDictionary: runtime.tables.mktClassificationDictionary,
  },
});

printJson(result);

if (!result.ok) {
  process.exitCode = 1;
}
