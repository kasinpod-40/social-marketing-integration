import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_CONFIRMATION,
  INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_INTERNAL_HANDOFF,
  assertIndependentSelectOnlySql,
  assertInstagramGoogleAdsRemoteCollectorConfirmation,
  buildFailedChannelEvidence,
  buildInstagramGoogleAdsRemoteEvidence,
  parseRemoteJson,
  sanitizeIndependentRemoteEvidence,
  unwrapRemoteRows,
} from '../../scripts/lib/instagram-google-ads-remote-readiness-collector.js';

function channel(googleAds = false) {
  return {
    catalog: {
      connectorStatus: 'uat_pending',
      jobStatus: 'uat_pending',
      reportStatus: 'uat_pending',
      adapterRegistered: true,
      readerRegistered: true,
    },
    source: {
      identityAccepted: true,
      sourceUatComplete: true,
      coverageComplete: true,
      coverageFailureCount: 0,
      factsPresent: true,
      larkParityComplete: true,
      dateRangeSufficient: true,
      ...(googleAds ? {
        signedDeliveryComplete: true,
        deliveryReplayVerified: true,
        currencyTimezoneConsistent: true,
        adsEntityCount: 10,
        adsDailyCount: 30,
      } : { metaContinuationComplete: true }),
    },
    report: {
      settingsReady: true,
      materializerCompatible: true,
      larkWriterCompatible: true,
      previewWindows: [1, 3, 7, 30],
      nullZeroSemanticsVerified: true,
      ...(googleAds ? { sumBeforeRatioVerified: true } : {}),
    },
    incidents: { openTerminalDlqCount: 0, openCriticalAlertCount: 0 },
  };
}

test('internal collector requires the reviewed terminal handoff', () => {
  assert.throws(() => assertInstagramGoogleAdsRemoteCollectorConfirmation({
    CONFIRM_INSTAGRAM_GOOGLE_ADS_REMOTE_READINESS_COLLECTOR:
      INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_CONFIRMATION,
  }), (error) => (
    error?.code === 'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_INTERNAL_HANDOFF_REQUIRED'
  ));
  assert.equal(assertInstagramGoogleAdsRemoteCollectorConfirmation({
    CONFIRM_INSTAGRAM_GOOGLE_ADS_REMOTE_READINESS_COLLECTOR:
      INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_CONFIRMATION,
    MKT_INSTAGRAM_GOOGLE_ADS_REMOTE_INTERNAL_HANDOFF:
      INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_INTERNAL_HANDOFF,
  }), true);
});

test('builds independent Instagram and Google Ads channel evidence', () => {
  const evidence = buildInstagramGoogleAdsRemoteEvidence({
    runtime: {
      trueFlags: [],
      bindingsMatch: true,
      activeTrafficPercent: 100,
      pendingMigrationCount: 0,
      activeTargetWorkCount: 0,
      activeTargetLockCount: 0,
    },
    instagram: channel(false),
    googleAds: channel(true),
  });
  assert.equal(evidence.runtime.allExecutionFlagsFalse, true);
  assert.equal(evidence.channels.instagram_organic.source.metaContinuationComplete, true);
  assert.equal(evidence.channels.google_ads.source.deliveryReplayVerified, true);
  assert.deepEqual(evidence.channels.google_ads.report.previewWindows, [1, 3, 7, 30]);
});

test('one failed channel does not overwrite the other channel evidence', () => {
  const failedInstagram = buildFailedChannelEvidence('instagram_organic', 'META_EVIDENCE_MISSING');
  const evidence = buildInstagramGoogleAdsRemoteEvidence({
    runtime: {
      trueFlags: [], bindingsMatch: true, activeTrafficPercent: 100,
      pendingMigrationCount: 0, activeTargetWorkCount: 0, activeTargetLockCount: 0,
    },
    instagram: failedInstagram,
    googleAds: channel(true),
  });
  assert.equal(evidence.channels.instagram_organic.source.sourceUatComplete, false);
  assert.equal(evidence.channels.instagram_organic.source.collectionFailureCode, undefined);
  assert.equal(evidence.channels.google_ads.source.sourceUatComplete, true);
  assert.equal(evidence.channels.google_ads.source.adsEntityCount, 10);
});

test('blocks non-read-only SQL including mutation CTEs', () => {
  assert.equal(assertIndependentSelectOnlySql('SELECT 1;'), 'SELECT 1;');
  assert.throws(() => assertIndependentSelectOnlySql('UPDATE ads_daily_facts SET clicks = 0;'), (error) => (
    error?.code === 'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_NON_SELECT_BLOCKED'
  ));
  assert.throws(() => assertIndependentSelectOnlySql('WITH x AS (DELETE FROM x RETURNING *) SELECT * FROM x;'), (error) => (
    error?.code === 'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_NON_SELECT_BLOCKED'
  ));
});

test('parses prefixed Remote JSON and unwraps D1 pages', () => {
  const parsed = parseRemoteJson('notice\n[{"results":[{"count":2}]}]');
  assert.deepEqual(unwrapRemoteRows(parsed), [{ count: 2 }]);
});

test('redacts infrastructure and account identity fields recursively', () => {
  const sanitized = sanitizeIndependentRemoteEvidence({
    tableId: 'hidden',
    externalAccountId: 'hidden',
    nested: { token: 'hidden', count: 2 },
  });
  assert.deepEqual(sanitized, { nested: { count: 2 } });
});
