import { currencyAmountToMicros } from '../../../domain/src/entities/ads.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/** Independent GET reconciliation; returns only counts/flags, never identities or business amounts. */
export async function proveTikTokAdsDailyGrains(input) {
  const date = requireDateOnly(input.date);
  const snapshots = {};
  for (const grain of ['campaign', 'ad']) {
    snapshots[grain] = await input.client.listAllStatusDailyReport({ accessToken: input.accessToken,
      advertiserId: input.advertiserId, date, grain });
  }
  const stored = await input.db.prepare(`SELECT entity_type, external_entity_id, source_account_id,
    parent_campaign_id, parent_ad_group_id FROM ads_entity_state
    WHERE customer_key = ? AND platform = 'tiktok_ads' AND account_key = ?
      AND entity_type IN ('campaign', 'ad_group', 'ad') LIMIT 10001`)
    .bind(input.customerKey, input.accountKey).all();
  const masters = stored?.results ?? [];
  const entities = new Map();
  if (masters.length > 10000) fail('MASTER_BOUND');
  for (const row of masters) {
    const key = `${row.entity_type}:${row.external_entity_id}`;
    if (entities.has(key) || row.source_account_id !== input.advertiserId) fail('MASTER_OWNER');
    entities.set(key, row);
  }
  const results = {};
  const totals = {};
  for (const grain of ['campaign', 'ad']) {
    const source = snapshots[grain];
    if (!Array.isArray(source.rows) || source.rows.length !== source.totalCount || source.rows.length > 10000) fail('SOURCE_COUNT');
    const seen = new Set();
    const sum = { spend: 0, impressions: 0, clicks: 0 };
    let missingMasters = 0;
    let missingParents = 0;
    for (const row of source.rows) {
      const id = row?.dimensions?.[grain === 'ad' ? 'ad_id_v2' : 'campaign_id'];
      const day = row?.dimensions?.stat_time_day;
      if (typeof id !== 'string' || !/^\d+$/u.test(id) || seen.has(id)
        || ![date, `${date} 00:00:00`].includes(day)) fail('SOURCE_IDENTITY');
      seen.add(id);
      const master = entities.get(`${grain}:${id}`);
      if (!master) missingMasters++;
      else if (grain === 'ad') {
        const group = entities.get(`ad_group:${master.parent_ad_group_id}`);
        if (!entities.has(`campaign:${master.parent_campaign_id}`)
          || !group || group.parent_campaign_id !== master.parent_campaign_id) missingParents++;
      }
      const spend = currencyAmountToMicros(row?.metrics?.spend, 'spend');
      if (!Number.isSafeInteger(spend) || spend < 0) fail('SOURCE_METRIC');
      sum.spend += spend;
      for (const metric of ['impressions', 'clicks']) {
        const value = row?.metrics?.[metric];
        if (!/^(0|[1-9]\d*)$/u.test(String(value ?? ''))) fail('SOURCE_METRIC');
        sum[metric] += Number(value);
      }
      if (!Object.values(sum).every(Number.isSafeInteger)) fail('SOURCE_METRIC');
    }
    totals[grain] = sum;
    results[grain] = { rows: source.totalCount, pages: source.pageCount, missingMasters, missingParents };
  }
  return Object.freeze({ date, allStatuses: true, sampleOnly: false, grains: results,
    identityReconciled: Object.values(results).every(row => row.missingMasters + row.missingParents === 0),
    totalsMatch: Object.fromEntries(['spend', 'impressions', 'clicks'].map(metric =>
      [metric, totals.campaign[metric] === totals.ad[metric]])),
  });
}
function fail(reason) {
  throw permanentError('TikTok Ads daily grain proof failed', { code: `TIKTOK_ADS_DAILY_PROOF_${reason}` });
}
