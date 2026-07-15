import { readDevVars } from './lib/dev-vars.js';
import { createYouTubeClientsFromEnv } from '../packages/connectors/src/youtube/youtube-runtime-factory.js';
import { preflightYouTubeDevAccess } from '../packages/application/src/use-cases/preflight-youtube-dev-access.js';
import { readYouTubeChannelIdFromEnv } from '../packages/config/src/youtube-organic-runtime-config.js';

try {
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const clients = createYouTubeClientsFromEnv(env);
  const result = await preflightYouTubeDevAccess({
    ...clients,
    channelId: readYouTubeChannelIdFromEnv(env),
    analyticsEnabled: readBoolean(env.MKT_YOUTUBE_ANALYTICS_ENABLED, false),
    analyticsStartDate: optionalText(env.YOUTUBE_ANALYTICS_PREFLIGHT_START_DATE),
    analyticsEndDate: optionalText(env.YOUTUBE_ANALYTICS_PREFLIGHT_END_DATE),
    sampleLimit: readPositiveInteger(env.YOUTUBE_PREFLIGHT_SAMPLE_LIMIT, 3),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error?.code ?? 'UNEXPECTED_ERROR',
    retryable: error?.retryable === true,
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new TypeError('Boolean environment value must be true or false');
}
function readPositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError('Positive integer environment value required');
  return number;
}
