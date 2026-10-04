import { createLarkBitableClientFromEnv } from '../../../packages/connectors/src/lark/lark-bitable.client.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import { sanitizeOperationalError } from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { hydrateRuntimeEnvFromD1 } from './runtime-config-hydration.js';

export const TIKTOK_ADS_LARK_SCHEMA_PATH = '/operator/tiktok-ads/lark-schema';
const TABLE_KEYS = Object.freeze({ accounts: 'mktAdsAccounts', ad_groups: 'mktAdsAdGroups',
  ads: 'mktAdsAds', creatives: 'mktAdsCreatives', campaigns: 'mktAdsCampaigns', daily: 'mktAdsDaily', summary: 'mktAdsCampaignSummary' });

/** อ่าน schema ของ Paid Ads ที่ระบุไว้เท่านั้น; Secret ใช้ใน Worker และไม่คืน IDs หรือ records */
export function createTikTokAdsLarkSchemaHttpHandler(dependencies = {}) {
  const hydrate = dependencies.hydrate ?? hydrateRuntimeEnvFromD1;
  const createClient = dependencies.createClient ?? createLarkBitableClientFromEnv;
  return async function handle({ request, env, url }) {
    if (url.pathname !== TIKTOK_ADS_LARK_SCHEMA_PATH) return null;
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
    if (request.method !== 'GET') return json({ ok: false }, { status: 405, headers: { ...headers, allow: 'GET' } });
    const match = /^Bearer[ \t]+(.+)$/iu.exec(request.headers.get('authorization') ?? '');
    if (!match || !await timingSafeEqualText(match[1].trim(), env?.MKT_CONNECTION_OPERATOR_TOKEN)) {
      return json({ ok: false }, { status: 401, headers });
    }
    const table = url.searchParams.get('table');
    if (url.searchParams.size !== 1 || !Object.hasOwn(TABLE_KEYS, table)) return json({ ok: false }, { status: 400, headers });
    if (env?.MKT_ENV !== 'production' || env?.MKT_CUSTOMER_PROFILE !== 'chemistry_k'
      || env?.MKT_CONNECTION_CUSTOMER_KEY !== 'chemistry_k') return json({ ok: false }, { status: 409, headers });
    try {
      const runtime = await hydrate(env);
      const tableKey = TABLE_KEYS[table];
      const tableId = readLarkTableIdsFromEnv(runtime, [tableKey])[tableKey];
      const fields = await createClient(runtime).listFields({ tableId });
      return json({ ok: true, readOnly: true, table, fieldCount: fields.length,
        fields: fields.map(field => ({ name: field.fieldName, type: Number(field.type), primary: field.isPrimary === true,
          tiktokOptionPresent: (field.property?.options ?? []).some(option => option.name === 'tiktok_ads'),
          campaignOptionPresent: (field.property?.options ?? []).some(option => option.name === 'campaign'),
          requiredOptions: Object.fromEntries(['ad','image','post','carousel','active','paused','removed','unknown','video','customer','customer_owned','client','developer','integration_workspace','connected','selectable'].map(name => [name,
            (field.property?.options ?? []).some(option => option.name === name)])) })),
      }, { status: 200, headers });
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      return json({ ok: false, code: operational.code ?? 'TIKTOK_ADS_LARK_SCHEMA_FAILED',
        ...(Number.isInteger(operational.details?.larkCode) ? { larkCode: operational.details.larkCode } : {}),
      }, { status: 502, headers });
    }
  };
}
