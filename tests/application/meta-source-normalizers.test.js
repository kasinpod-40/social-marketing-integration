import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  normalizeMetaAdsDailyFixture,
  normalizeMetaAdsEntityFixture,
} from '../../packages/application/src/use-cases/normalize-meta-ads-source.js';
import {
  normalizeMetaOrganicAccountFixture,
  normalizeMetaOrganicContentFixture,
  normalizeMetaOrganicInsightsFixture,
} from '../../packages/application/src/use-cases/normalize-meta-organic-source.js';
import {
  safeMetaSourceJson,
} from '../../packages/connectors/src/meta/meta-business-normalization.helpers.js';

const FETCHED_AT = '2026-07-24T12:00:00Z';
const SYNC_RUN_ID = 'sync_fixture_001';

test('Facebook fixture normalizes account, content and observed zero without inventing history', async () => {
  const fixture = await readFixture('facebook-organic.json');
  const account = normalizeMetaOrganicAccountFixture({
    platform: 'facebook',
    expectedAccountId: fixture.account.id,
    resource: fixture.account,
    fetchedAt: FETCHED_AT,
    syncRunId: SYNC_RUN_ID,
  });
  const content = normalizeMetaOrganicContentFixture({
    platform: 'facebook',
    sourceAccountId: fixture.account.id,
    resource: fixture.content[0],
    fetchedAt: FETCHED_AT,
    syncRunId: SYNC_RUN_ID,
  });
  const metrics = normalizeMetaOrganicInsightsFixture({
    platform: 'facebook',
    entityType: 'content',
    sourceAccountId: fixture.account.id,
    sourceEntityId: fixture.content[0].id,
    insights: fixture.content_insights,
    fetchedAt: FETCHED_AT,
    syncRunId: SYNC_RUN_ID,
  });

  assert.equal(account.rawRow.raw_account_key, 'facebook:page_fixture_001');
  assert.equal(account.rawRow.followers_count, 1250);
  assert.equal(account.rawRow.profile_url, 'https://example.test/facebook/fixture?tracking=remove');
  assert.equal(content.rawRow.raw_content_key, 'facebook:page_fixture_001:post_fixture_001');
  assert.equal(content.rawRow.content_type, 'post');
  assert.equal(metrics.rawRows.length, 1);
  assert.equal(metrics.rawRows[0].value_number, 0);
  assert.equal(metrics.rawRows[0].metric_date, '2026-07-24');
  assert.equal(metrics.rawRows[0].timezone_basis, 'asia_bangkok');
  assert.match(metrics.rawRows[0].raw_metric_key, /:1784851200000$/u);
});

test('Instagram fixture preserves structured total_value and authoritative user_id', async () => {
  const fixture = await readFixture('instagram-organic.json');
  const account = normalizeMetaOrganicAccountFixture({
    platform: 'instagram',
    expectedAccountId: fixture.account.user_id,
    resource: fixture.account,
    fetchedAt: FETCHED_AT,
    syncRunId: SYNC_RUN_ID,
  });
  const content = normalizeMetaOrganicContentFixture({
    platform: 'instagram',
    sourceAccountId: fixture.account.user_id,
    resource: fixture.content[0],
    fetchedAt: FETCHED_AT,
    syncRunId: SYNC_RUN_ID,
  });
  const metrics = normalizeMetaOrganicInsightsFixture({
    platform: 'instagram',
    entityType: 'content',
    sourceAccountId: fixture.account.user_id,
    sourceEntityId: fixture.content[0].id,
    insights: fixture.content_insights,
    fetchedAt: FETCHED_AT,
    syncRunId: SYNC_RUN_ID,
  });

  assert.equal(account.rawRow.source_account_id, 'ig_fixture_001');
  assert.equal(account.rawRow.account_type, 'business');
  assert.equal(content.rawRow.content_type, 'reel');
  assert.equal(metrics.rawRows[0].value_number, null);
  assert.deepEqual(JSON.parse(metrics.rawRows[0].value_json), { like: 10, comment: 0 });
  assert.equal(metrics.rawRows[0].response_shape, 'total_value');
});

test('Instagram unavailable insight descriptor becomes explicit null without accepting malformed rows', () => {
  const input = {
    platform: 'instagram',
    entityType: 'account',
    sourceAccountId: 'ig_fixture_001',
    sourceEntityId: 'ig_fixture_001',
    fetchedAt: FETCHED_AT,
    syncRunId: SYNC_RUN_ID,
  };
  const normalized = normalizeMetaOrganicInsightsFixture({
    ...input,
    insights: [{
      name: 'follows_and_unfollows',
      period: 'day',
      id: 'ig_fixture_001/insights/follows_and_unfollows/day',
      title: 'Follows and unfollows',
      description: 'Unavailable for the selected range',
    }],
  });
  assert.equal(normalized.rawRows.length, 1);
  assert.equal(normalized.rawRows[0].value_number, null);
  assert.equal(normalized.rawRows[0].value_json, null);
  assert.equal(normalized.rawRows[0].response_shape, 'unavailable');

  assert.throws(
    () => normalizeMetaOrganicInsightsFixture({
      ...input,
      insights: [{ name: 'follows_and_unfollows', period: 'day' }],
    }),
    /response shape is unsupported/u,
  );
});

test('Meta Ads fixture maps exact money micros and keeps actions unmapped', async () => {
  const fixture = await readFixture('meta-ads.json');
  const account = normalizeMetaAdsEntityFixture({
    entityType: 'account',
    accountId: 'act_987650001',
    resource: fixture.account,
    fetchedAt: FETCHED_AT,
    syncRunId: SYNC_RUN_ID,
  });
  const entity = normalizeMetaAdsEntityFixture({
    entityType: 'campaign',
    accountId: 'act_987650001',
    resource: fixture.campaign,
    fetchedAt: FETCHED_AT,
    syncRunId: SYNC_RUN_ID,
  });
  const daily = normalizeMetaAdsDailyFixture({
    accountId: 'act_987650001',
    accountKey: 'chemistry_k',
    accountTimezone: 'Asia/Bangkok',
    currency: 'THB',
    resource: fixture.daily,
    fetchedAt: FETCHED_AT,
    syncRunId: SYNC_RUN_ID,
  });

  assert.equal(account.rawRow.account_id, '987650001');
  assert.equal(account.rawRow.currency, 'THB');
  assert.equal(
    entity.rawRow.raw_ads_entity_key,
    'meta_ads:987650001:campaign:campaign_fixture_001',
  );
  assert.equal(daily.rawRow.spend_micros, 100250001);
  assert.equal(daily.rawRow.ad_channel, 'instagram_ads');
  assert.equal(daily.rawRow.conversions, null);
  assert.equal(daily.factCandidate.conversionValueMicros, null);
  assert.deepEqual(JSON.parse(daily.factCandidate.actionsJson), fixture.daily.actions);
  assert.deepEqual(JSON.parse(daily.factCandidate.actionValuesJson), fixture.daily.action_values);
  assert.equal(
    daily.factCandidate.adsFactKey,
    'meta_ads:chemistry_k:ad:ad_fixture_001:2026-07-23:publisher_platform=instagram:none',
  );
});

test('Meta normalizers fail closed on identity, duplicate metrics and unapproved timezone', async () => {
  const facebook = await readFixture('facebook-organic.json');
  assert.throws(
    () => normalizeMetaOrganicAccountFixture({
      platform: 'facebook',
      expectedAccountId: 'different_page',
      resource: facebook.account,
      fetchedAt: FETCHED_AT,
      syncRunId: SYNC_RUN_ID,
    }),
    (error) => error?.code === 'META_FACEBOOK_PAGE_IDENTITY_MISMATCH',
  );

  assert.throws(
    () => normalizeMetaOrganicInsightsFixture({
      platform: 'facebook',
      entityType: 'content',
      sourceAccountId: facebook.account.id,
      sourceEntityId: facebook.content[0].id,
      insights: [facebook.content_insights[0], facebook.content_insights[0]],
      fetchedAt: FETCHED_AT,
      syncRunId: SYNC_RUN_ID,
    }),
    /duplicate metric Stable key/u,
  );

  assert.throws(
    () => normalizeMetaOrganicInsightsFixture({
      platform: 'facebook',
      entityType: 'content',
      sourceAccountId: facebook.account.id,
      sourceEntityId: facebook.content[0].id,
      insights: [],
      reportingTimezone: 'UTC',
      fetchedAt: FETCHED_AT,
      syncRunId: SYNC_RUN_ID,
    }),
    /must be Asia\/Bangkok/u,
  );
});

test('Meta source payload JSON redacts tokens, removes URL query/fragment and has a hard size cap', () => {
  const safe = JSON.parse(safeMetaSourceJson({
    access_token: 'synthetic-secret',
    nested: { appsecret_proof: 'synthetic-proof' },
    next: 'https://graph.example.test/path?access_token=synthetic-secret#fragment',
  }));

  assert.equal(safe.access_token, '[REDACTED]');
  assert.equal(safe.nested.appsecret_proof, '[REDACTED]');
  assert.equal(safe.next, 'https://graph.example.test/path');
  assert.throws(
    () => safeMetaSourceJson({ payload: 'x'.repeat(70_000) }),
    /exceeds 65536 bytes/u,
  );
});

test('Meta Ads normalizer preserves the reviewed publisher-platform footprint', async () => {
  const fixture = await readFixture('meta-ads.json');
  const base = {
    accountId: '987650001',
    accountKey: 'chemistry_k',
    accountTimezone: 'Asia/Bangkok',
    currency: 'THB',
    fetchedAt: FETCHED_AT,
    syncRunId: SYNC_RUN_ID,
  };
  const mappings = new Map([
    ['audience_network', 'audience_network_ads'],
    ['facebook', 'facebook_ads'],
    ['instagram', 'instagram_ads'],
    ['messenger', 'messenger_ads'],
    ['threads', 'threads_ads'],
    ['unknown', null],
    ['whatsapp', 'whatsapp_ads'],
  ]);

  for (const [publisherPlatform, adChannel] of mappings) {
    const daily = normalizeMetaAdsDailyFixture({
      ...base,
      resource: { ...fixture.daily, publisher_platform: publisherPlatform },
    });
    assert.equal(daily.rawRow.ad_channel, adChannel);
    assert.equal(daily.factCandidate.adChannel, adChannel);
    assert.equal(daily.rawRow.breakdown_key, `publisher_platform=${publisherPlatform}`);
    assert.deepEqual(
      JSON.parse(daily.rawRow.breakdown_json),
      { publisher_platform: publisherPlatform },
    );
    assert.match(
      daily.factCandidate.adsFactKey,
      new RegExp(`:publisher_platform=${publisherPlatform}:none$`, 'u'),
    );
  }
});

test('Meta Ads normalizer rejects malformed money and unreviewed publisher platforms', async () => {
  const fixture = await readFixture('meta-ads.json');
  const base = {
    accountId: '987650001',
    accountKey: 'chemistry_k',
    accountTimezone: 'Asia/Bangkok',
    currency: 'THB',
    fetchedAt: FETCHED_AT,
    syncRunId: SYNC_RUN_ID,
  };
  assert.throws(
    () => normalizeMetaAdsDailyFixture({
      ...base,
      resource: { ...fixture.daily, spend: '1.0000001' },
    }),
    /at most 6 places/u,
  );
  assert.throws(
    () => normalizeMetaAdsDailyFixture({
      ...base,
      resource: { ...fixture.daily, publisher_platform: 'future_network' },
    }),
    /publisher_platform is unsupported/u,
  );
});

async function readFixture(name) {
  const url = new URL(`../fixtures/meta/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, 'utf8'));
}
