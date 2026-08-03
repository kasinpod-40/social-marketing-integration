import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTAGRAM_GOOGLE_ADS_READINESS_CONFIRMATION,
  assertInstagramGoogleAdsReadinessConfirmation,
  assessInstagramGoogleAdsReadiness,
  parseInstagramGoogleAdsReadinessArgs,
} from '../../scripts/lib/instagram-google-ads-report-readiness-audit.js';

function readyChannel(overrides = {}) {
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
    },
    report: {
      settingsReady: true,
      materializerCompatible: true,
      larkWriterCompatible: true,
      previewWindows: [1, 3, 7, 30],
      nullZeroSemanticsVerified: true,
    },
    incidents: {
      openTerminalDlqCount: 0,
      openCriticalAlertCount: 0,
    },
    ...overrides,
  };
}

function readyInput() {
  const instagram = readyChannel();
  instagram.source.metaContinuationComplete = true;
  const googleAds = readyChannel();
  Object.assign(googleAds.source, {
    signedDeliveryComplete: true,
    deliveryReplayVerified: true,
    currencyTimezoneConsistent: true,
    adsEntityCount: 1090,
    adsDailyCount: 285,
  });
  googleAds.report.sumBeforeRatioVerified = true;
  return {
    target: {
      environment: 'development',
      customerProfile: 'integration_workspace',
      accountKey: 'chemistry_k',
    },
    runtime: {
      allExecutionFlagsFalse: true,
      bindingsMatch: true,
      activeTrafficPercent: 100,
      pendingMigrationCount: 0,
      activeTargetWorkCount: 0,
      activeTargetLockCount: 0,
    },
    channels: {
      instagram_organic: instagram,
      google_ads: googleAds,
    },
  };
}

test('Instagram and Google Ads audit is plan-only and exact-confirmation gated', () => {
  assert.deepEqual(parseInstagramGoogleAdsReadinessArgs([]), { execute: false });
  assert.deepEqual(parseInstagramGoogleAdsReadinessArgs(['--execute']), { execute: true });
  assert.throws(() => parseInstagramGoogleAdsReadinessArgs(['--promote']));
  assert.throws(() => assertInstagramGoogleAdsReadinessConfirmation({}));
  assert.equal(assertInstagramGoogleAdsReadinessConfirmation({
    CONFIRM_INSTAGRAM_GOOGLE_ADS_READINESS_AUDIT: INSTAGRAM_GOOGLE_ADS_READINESS_CONFIRMATION,
  }), true);
});

test('Instagram and Google Ads produce independent promotion decisions', () => {
  const result = assessInstagramGoogleAdsReadiness(readyInput());
  assert.equal(result.independentDecisions, true);
  assert.equal(result.promotionReadyCount, 2);
  assert.equal(result.channels.instagram_organic.promotionReady, true);
  assert.equal(result.channels.google_ads.promotionReady, true);
  assert.equal(result.channels.instagram_organic.nextGate, 'catalog_promotion_ready');
  assert.equal(result.channels.google_ads.nextGate, 'catalog_promotion_ready');
});

test('Meta continuation blocks Instagram without blocking ready Google Ads', () => {
  const input = readyInput();
  input.channels.instagram_organic.source.metaContinuationComplete = false;
  const result = assessInstagramGoogleAdsReadiness(input);
  assert.equal(result.promotionReadyCount, 1);
  assert.equal(result.channels.instagram_organic.promotionReady, false);
  assert.equal(result.channels.instagram_organic.nextGate, 'meta_continuation_pending');
  assert.equal(result.channels.google_ads.promotionReady, true);
});

test('Google Ads requires completed signed delivery, Ads facts and SUM-before-ratio proof', () => {
  const input = readyInput();
  Object.assign(input.channels.google_ads.source, {
    signedDeliveryComplete: false,
    adsDailyCount: 0,
  });
  input.channels.google_ads.report.sumBeforeRatioVerified = false;
  const result = assessInstagramGoogleAdsReadiness(input);
  const blockers = result.channels.google_ads.blockers.map((entry) => entry.code);
  assert.equal(result.channels.instagram_organic.promotionReady, true);
  assert.equal(result.channels.google_ads.promotionReady, false);
  assert.ok(blockers.includes('signed_delivery_pending'));
  assert.ok(blockers.includes('source_facts_missing'));
  assert.ok(blockers.includes('ads_sum_before_ratio_pending'));
});

test('Shared unsafe runtime blocks both channels without merging their source blockers', () => {
  const input = readyInput();
  input.runtime.activeTargetLockCount = 1;
  input.channels.instagram_organic.source.metaContinuationComplete = false;
  const result = assessInstagramGoogleAdsReadiness(input);
  assert.equal(result.promotionReadyCount, 0);
  assert.ok(result.channels.instagram_organic.blockers.some((entry) => entry.code === 'active_work_or_lock'));
  assert.ok(result.channels.google_ads.blockers.some((entry) => entry.code === 'active_work_or_lock'));
  assert.ok(result.channels.instagram_organic.blockers.some((entry) => entry.code === 'meta_continuation_pending'));
  assert.ok(!result.channels.google_ads.blockers.some((entry) => entry.code === 'meta_continuation_pending'));
});
