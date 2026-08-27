import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRIMARY_SCHEDULE_CRON,
  buildScheduledJobs,
} from '../../apps/sync-worker/src/index.js';
import { assertConnectorRunnable } from '../../packages/application/src/connectors/connector-registry.js';
import {
  JOB_IMPLEMENTATION_STATUS,
  JOB_TRIGGERS,
  JOB_TYPES,
  getJobDefinition,
} from '../../packages/application/src/jobs/job-catalog.js';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';
import {
  CONNECTOR_IMPLEMENTATION_STATUS,
  getConnectorCatalogEntry,
} from '../../packages/config/src/connector-catalog.js';

test('reviewed Facebook, Instagram and Meta Ads catalogs are active', () => {
  for (const connectorKey of ['facebook', 'instagram']) {
    assert.equal(
      getConnectorCatalogEntry(connectorKey).implementationStatus,
      CONNECTOR_IMPLEMENTATION_STATUS.ACTIVE,
    );
  }

  for (const type of [JOB_TYPES.FACEBOOK_ORGANIC_SYNC, JOB_TYPES.INSTAGRAM_ORGANIC_SYNC]) {
    const definition = getJobDefinition(type);
    assert.equal(definition.implementationStatus, JOB_IMPLEMENTATION_STATUS.ACTIVE);
    assert.notEqual(definition.manualOnly, true);
    assert.deepEqual(definition.allowedTriggers, [
      JOB_TRIGGERS.META_MANUAL_UAT,
      JOB_TRIGGERS.META_ORGANIC_SCHEDULED,
    ]);
  }

  const ads = getJobDefinition(JOB_TYPES.META_ADS_SYNC);
  assert.equal(ads.implementationStatus, JOB_IMPLEMENTATION_STATUS.ACTIVE);
  assert.notEqual(ads.manualOnly, true);
  assert.deepEqual(ads.allowedTriggers, [
    JOB_TRIGGERS.META_MANUAL_UAT,
    JOB_TRIGGERS.META_ORGANIC_SCHEDULED,
  ]);
});

test('Integration Workspace can enable reviewed Meta Organic connectors without protected UAT mode', () => {
  const runtime = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_FACEBOOK_ENABLED: 'true',
    MKT_CONNECTOR_INSTAGRAM_ENABLED: 'true',
    MKT_META_SOURCE_READ_ENABLED: 'true',
  });

  assert.equal(runtime.connectors.facebook.protectedUatRuntime, false);
  assert.equal(runtime.connectors.instagram.protectedUatRuntime, false);
  assert.doesNotThrow(() => assertConnectorRunnable(runtime, 'facebook'));
  assert.doesNotThrow(() => assertConnectorRunnable(runtime, 'instagram'));
});

test('Facebook schedule emits one stable previous-day job at Bangkok 06:30', () => {
  const scheduledAt = '2026-08-08T23:30:00.000Z';
  const jobs = buildPrimary({
    scheduledAt,
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_FACEBOOK_ENABLED: 'true',
      MKT_SCHEDULE_INSTAGRAM_ENABLED: 'false',
    },
  });

  assert.deepEqual(jobs.map((job) => job.type), [
    JOB_TYPES.FACEBOOK_ORGANIC_SYNC,
    JOB_TYPES.RELIABILITY_MIRROR_DELIVER,
  ]);
  assert.equal(jobs[0].trigger, JOB_TRIGGERS.META_ORGANIC_SCHEDULED);
  assert.equal(jobs[0].periodStart, '2026-08-08');
  assert.equal(jobs[0].periodEnd, '2026-08-08');
  assert.equal(jobs[0].operationId, 'facebook-scheduled-20260808');
  assert.equal(jobs[0].workKey, 'facebook:facebook-scheduled-20260808');
  assert.equal(jobs[0].originalRequestedAt, Date.parse(scheduledAt));
  assert.equal(jobs[0].generation, Date.parse(scheduledAt));
  assert.equal(jobs[0].dryRun, false);
  assert.equal(jobs[0].d1Only, false);
});

test('Instagram schedule is staggered to Bangkok 07:30 and uses its own stable identity', () => {
  const scheduledAt = '2026-08-09T00:30:00.000Z';
  const jobs = buildPrimary({
    scheduledAt,
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_FACEBOOK_ENABLED: 'false',
      MKT_SCHEDULE_INSTAGRAM_ENABLED: 'true',
    },
  });

  assert.deepEqual(jobs.map((job) => job.type), [
    JOB_TYPES.INSTAGRAM_ORGANIC_SYNC,
    JOB_TYPES.RELIABILITY_MIRROR_DELIVER,
  ]);
  assert.equal(jobs[0].periodStart, '2026-08-08');
  assert.equal(jobs[0].periodEnd, '2026-08-08');
  assert.equal(jobs[0].operationId, 'instagram-scheduled-20260808');
  assert.equal(jobs[0].workKey, 'instagram:instagram-scheduled-20260808');
});

test('Meta Organic schedules remain disabled by default and support explicit 5-minute time overrides', () => {
  const disabled = buildPrimary({
    scheduledAt: '2026-08-09T00:30:00.000Z',
    env: { DEFAULT_TIMEZONE: 'Asia/Bangkok' },
  });
  assert.deepEqual(disabled.map((job) => job.type), [JOB_TYPES.RELIABILITY_MIRROR_DELIVER]);

  const overridden = buildPrimary({
    scheduledAt: '2026-08-09T01:00:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_FACEBOOK_ENABLED: 'true',
      MKT_FACEBOOK_SYNC_TIME: '08:00',
    },
  });
  assert.equal(overridden[0].type, JOB_TYPES.FACEBOOK_ORGANIC_SYNC);

  assert.throws(() => buildPrimary({
    scheduledAt: '2026-08-09T01:00:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_FACEBOOK_ENABLED: 'true',
      MKT_FACEBOOK_SYNC_TIME: '08:02',
    },
  }), (error) => error?.code === 'MKT_SCHEDULE_CONFIG_INVALID');
});

test('Meta continuation keeps the originating trigger instead of reverting scheduled work to manual UAT', () => {
  const source = readFileSync(
    new URL('../../apps/sync-worker/src/meta-active-job-router.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /trigger:\s*input\.job\.body\.trigger/u);
  assert.doesNotMatch(source, /trigger:\s*'manual_uat',\s*\n\s*continuation:/u);
  assert.match(source, /Scheduled Meta job cannot reduce into dry-run or D1-only mode/u);
});

test('Meta router enqueues every durable post-source continuation phase', () => {
  const source = readFileSync(
    new URL('../../apps/sync-worker/src/meta-active-job-router.js', import.meta.url),
    'utf8',
  );
  for (const status of [
    'source_continuation',
    'preflight_continuation',
    'd1_continuation',
    'lark_continuation',
  ]) {
    assert.match(source, new RegExp(`'${status}'`, 'u'));
  }
});

function buildPrimary({ scheduledAt, env }) {
  return buildScheduledJobs({
    event: {
      cron: PRIMARY_SCHEDULE_CRON,
      scheduledTime: Date.parse(scheduledAt),
    },
    env,
  });
}
