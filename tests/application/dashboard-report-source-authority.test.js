import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveDashboardReportSourceAuthority,
} from '../../packages/application/src/reports/dashboard-report-source-authority.js';

const PLATFORM_SCOPES = Object.freeze([
  'chatwoot',
  'facebook',
  'google_ads',
  'instagram',
  'meta_ads',
  'tiktok',
  'woocommerce',
  'youtube',
]);

const SOURCE_REPORT_IDS = Object.freeze([
  'integration_workspace:chatwoot:rolling:7d:chemistry_k:rolling_days:2026-08-03:2026-08-09:chatwoot-customer-service-v1',
  'integration_workspace:facebook:rolling:7d:chemistry_k:rolling_days:2026-08-03:2026-08-09:facebook-organic-v1',
  'integration_workspace:google_ads:rolling:7d:chemistry_k:rolling_days:2026-08-03:2026-08-09:google-ads-v1',
  'integration_workspace:instagram:rolling:7d:chemistry_k:rolling_days:2026-08-03:2026-08-09:instagram-organic-v1',
  'integration_workspace:meta_ads:rolling:7d:chemistry_k:rolling_days:2026-08-03:2026-08-09:meta-ads-v1',
  'integration_workspace:tiktok:rolling:7d:chemistry_k:rolling_days:2026-08-03:2026-08-09:tiktok-organic-v1',
  'integration_workspace:woocommerce:rolling:7d:chemistry_k:rolling_days:2026-08-03:2026-08-09:woocommerce-commerce-v1',
  'integration_workspace:youtube:rolling:7d:chemistry_k:rolling_days:2026-08-03:2026-08-09:youtube-organic-v1',
]);

test('rebuilds the exact accepted Fresh v4 Report identities through shared Report contracts', () => {
  const authority = resolveDashboardReportSourceAuthority({
    sourceReportIds: SOURCE_REPORT_IDS,
    platformScopes: PLATFORM_SCOPES,
    profileKey: 'integration_workspace',
    accountKey: 'chemistry_k',
    periodKind: 'rolling_days',
    periodStart: '2026-08-03',
    periodEnd: '2026-08-09',
    windowDays: 7,
  });

  assert.deepEqual(authority.sourceReportIds, [...SOURCE_REPORT_IDS].sort());
  assert.deepEqual(authority.reportSettingKeys, [
    'integration_workspace:chatwoot:rolling:7d',
    'integration_workspace:facebook:rolling:7d',
    'integration_workspace:google_ads:rolling:7d',
    'integration_workspace:instagram:rolling:7d',
    'integration_workspace:meta_ads:rolling:7d',
    'integration_workspace:tiktok:rolling:7d',
    'integration_workspace:woocommerce:rolling:7d',
    'integration_workspace:youtube:rolling:7d',
  ]);
  assert.equal(authority.authorities.length, 8);
  assert.equal(authority.authorities.some(({ platformScope }) => platformScope === 'tiktok_ads'), false);
});

test('fails closed instead of parsing or accepting an altered historical Report identity', () => {
  const altered = [...SOURCE_REPORT_IDS];
  altered[1] = altered[1].replace('facebook-organic-v1', 'facebook-organic-v2');

  assert.throws(
    () => resolveDashboardReportSourceAuthority({
      sourceReportIds: altered,
      platformScopes: PLATFORM_SCOPES,
      profileKey: 'integration_workspace',
      accountKey: 'chemistry_k',
      periodKind: 'rolling_days',
      periodStart: '2026-08-03',
      periodEnd: '2026-08-09',
      windowDays: 7,
    }),
    (error) => error?.code === 'DASHBOARD_REPORT_SOURCE_AUTHORITY_MISMATCH'
      && error?.details?.missingCount === 1
      && error?.details?.unexpectedCount === 1,
  );
});
