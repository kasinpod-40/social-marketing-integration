import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTikTokOrganicReportResults } from '../../packages/application/src/reports/compare-tiktok-organic-report-results.js';

function calculation(overrides = {}) {
  return {
    dataStatus: 'complete',
    baselineCoverageRate: 1,
    sourceSnapshotCount: 2,
    trackedContentCount: 1,
    coveredContentCount: 1,
    metrics: {
      period_views: 25,
      period_engagement_rate: 0.123456789,
    },
    contentRows: [{
      content: { externalContentId: 'video-1' },
      baselineMode: 'actual',
      dataStatus: 'complete',
      periodViews: 25,
      periodEngagement: 4,
    }],
    ...overrides,
  };
}

test('identical TikTok report calculations have exact parity and stable digests', async () => {
  const result = await compareTikTokOrganicReportResults({
    primary: calculation(),
    shadow: calculation(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.primaryDigest, result.shadowDigest);
});

test('integer and identity mismatches are never hidden by float tolerance', async () => {
  const result = await compareTikTokOrganicReportResults({
    primary: calculation(),
    shadow: calculation({
      metrics: { period_views: 26, period_engagement_rate: 0.123456789 },
      contentRows: [{
        content: { externalContentId: 'video-2' },
        baselineMode: 'actual',
        dataStatus: 'complete',
        periodViews: 26,
        periodEngagement: 4,
      }],
    }),
    floatTolerance: 1,
  });

  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((item) => item.path.includes('period_views')));
  assert.ok(result.mismatches.some((item) => item.path.includes('externalContentId')));
});

test('floating metrics use the explicit bounded tolerance', async () => {
  const within = await compareTikTokOrganicReportResults({
    primary: calculation(),
    shadow: calculation({
      metrics: { period_views: 25, period_engagement_rate: 0.1234567895 },
    }),
    floatTolerance: 1e-9,
  });
  assert.equal(within.ok, true);

  const outside = await compareTikTokOrganicReportResults({
    primary: calculation(),
    shadow: calculation({
      metrics: { period_views: 25, period_engagement_rate: 0.1235 },
    }),
    floatTolerance: 1e-9,
  });
  assert.equal(outside.ok, false);
});
