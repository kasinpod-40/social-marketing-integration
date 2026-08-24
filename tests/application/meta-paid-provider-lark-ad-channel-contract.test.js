import test from 'node:test';
import assert from 'node:assert/strict';

import { planMetaPaidProviderLarkTarget } from '../../scripts/lib/meta-paid-provider-direct-lark-materializer.js';

test('Meta provider Lark planner omits non-canonical placement channels without mutating source rows', async () => {
  const sourceDailyRows = [
    Object.freeze({ ads_daily_key: 'daily-facebook', ad_channel: 'facebook_ads', spend: 1 }),
    Object.freeze({ ads_daily_key: 'daily-instagram', ad_channel: 'instagram_ads', spend: 2 }),
    Object.freeze({ ads_daily_key: 'daily-audience', ad_channel: 'audience_network_ads', spend: 3 }),
    Object.freeze({ ads_daily_key: 'daily-messenger', ad_channel: 'messenger_ads', spend: 4 }),
    Object.freeze({ ads_daily_key: 'daily-threads', ad_channel: 'threads_ads', spend: 5 }),
    Object.freeze({ ads_daily_key: 'daily-whatsapp', ad_channel: 'whatsapp_ads', spend: 6 }),
    Object.freeze({ ads_daily_key: 'daily-no-channel', spend: 7 }),
  ];
  const writeSet = Object.freeze({
    canonical: Object.freeze({
      adsCreatives: Object.freeze([]),
      adsDaily: Object.freeze(sourceDailyRows),
    }),
  });
  const plannedRowsByTable = new Map();
  const syncEngine = {
    async planByKey({ tableId, rows }) {
      plannedRowsByTable.set(tableId, rows);
      return Object.freeze({
        createRows: Object.freeze([]),
        updateRows: Object.freeze([]),
        skipped: rows.length,
        duplicateInputRows: 0,
      });
    },
    async executePlan() {
      throw new Error('executePlan must not run during planner contract test');
    },
  };

  await planMetaPaidProviderLarkTarget({
    target: 'chemistry_k2',
    writeSet,
    repository: {},
    syncEngine,
    tables: {
      mktAdsCreatives: 'tbl_creatives_fixture',
      mktAdsDaily: 'tbl_daily_fixture',
    },
  });

  const plannedDaily = plannedRowsByTable.get('tbl_daily_fixture');
  assert.equal(plannedDaily.length, sourceDailyRows.length);
  assert.equal(plannedDaily[0].ad_channel, 'facebook_ads');
  assert.equal(plannedDaily[1].ad_channel, 'instagram_ads');
  for (const row of plannedDaily.slice(2)) {
    assert.equal(Object.hasOwn(row, 'ad_channel'), false);
  }

  assert.equal(sourceDailyRows[2].ad_channel, 'audience_network_ads');
  assert.equal(sourceDailyRows[3].ad_channel, 'messenger_ads');
  assert.equal(sourceDailyRows[4].ad_channel, 'threads_ads');
  assert.equal(sourceDailyRows[5].ad_channel, 'whatsapp_ads');
  assert.equal(Object.hasOwn(sourceDailyRows[6], 'ad_channel'), false);
});
