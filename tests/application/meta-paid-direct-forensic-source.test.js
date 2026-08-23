import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMetaPaidDirectCandidateSql,
  normalizeMetaPaidDirectCandidate,
  normalizeMetaPaidDirectUnits,
  validateMetaPaidDirectSourceSnapshot,
} from '../../scripts/lib/meta-paid-direct-lark-materializer.js';

const GENERATION = Date.parse('2026-08-20T06:00:00Z');
const FORENSIC_WORK_KEY =
  'meta_ads:chemistry_k2:meta-chemistry_k2-history-20260501-20260731-a22a21bea8ba';

function candidateRow(workKey = FORENSIC_WORK_KEY) {
  return {
    work_key: workKey,
    cursor_key: 'meta:integration_workspace:meta_ads:chemistry_k',
    work_type: 'meta_ads_sync',
    generation: GENERATION,
    requested_at: GENERATION,
    lifecycle_status: 'complete',
    work_created_at: GENERATION,
    work_updated_at: GENERATION + 1000,
    source_state_json: JSON.stringify({
      stage: 'complete',
      pageState: null,
      contentIds: [],
      contentIndex: 0,
      unitCount: 3,
      rowCount: 4,
      sourceWatermark: '2026-07-31T23:59:59Z',
    }),
    source_expected_items: 3,
    source_processed_items: 3,
    source_pages_processed: 3,
    source_chunks_processed: 3,
    source_complete: 1,
    source_created_at: GENERATION,
    source_updated_at: GENERATION + 1000,
    d1_state_json: JSON.stringify({ nextIndex: 1 }),
    d1_expected_items: 1,
    d1_processed_items: 1,
    d1_pages_processed: 0,
    d1_chunks_processed: 1,
    d1_complete: 1,
    d1_created_at: GENERATION,
    d1_updated_at: GENERATION + 1000,
  };
}

function stagedPayload(datasetKey, rows) {
  return {
    schemaVersion: 'meta_end_to_end_staged_source_unit_v1',
    datasetKey,
    sourceEntityId: '987650001',
    sourceStatus: 'complete',
    sourceWatermark: '2026-07-31T23:59:59Z',
    pageNumber: 1,
    rows,
  };
}

function unitRows() {
  return [
    {
      unit_key: 'account:1',
      sequence: 0,
      payload_json: JSON.stringify(stagedPayload('meta_ads.account.latest', [{
        id: 'act_987650001',
        account_id: '987650001',
        name: 'Fixture Ad Account',
        account_status: 1,
        currency: 'THB',
        timezone_name: 'Asia/Bangkok',
      }])),
    },
    {
      unit_key: 'creatives:1',
      sequence: 1,
      payload_json: JSON.stringify(stagedPayload('meta_ads.creatives.inventory', [{
        id: 'creative_fixture_001',
        name: 'Fixture Creative',
        object_type: 'IMAGE',
      }])),
    },
    {
      unit_key: 'daily:1',
      sequence: 2,
      payload_json: JSON.stringify(stagedPayload('meta_ads.performance.daily', [
        {
          account_id: '987650001',
          campaign_id: 'campaign_1',
          adset_id: 'adset_1',
          ad_id: 'ad_1',
          date_start: '2026-06-30',
          date_stop: '2026-06-30',
        },
        {
          account_id: '987650001',
          campaign_id: 'campaign_1',
          adset_id: 'adset_1',
          ad_id: 'ad_1',
          date_start: '2026-07-15',
          date_stop: '2026-07-15',
        },
      ])),
    },
  ];
}

test('direct discovery searches completed Meta work for the target, not only a never-created July work key', () => {
  const sql = buildMetaPaidDirectCandidateSql('chemistry_k2');
  assert.match(sql, /meta_ads:chemistry_k2:/u);
  assert.match(sql, /meta-chemistry_k2-history-20260701-20260731-/u);
  assert.doesNotMatch(sql, /\bLIKE\b|\bGLOB\b/iu);
});

test('completed May-July forensic source is eligible and Daily rows are scoped to July in memory', () => {
  const candidate = normalizeMetaPaidDirectCandidate(candidateRow(), 'chemistry_k2');
  assert.deepEqual(candidate.sourcePeriod, {
    since: '2026-05-01',
    until: '2026-07-31',
  });

  const snapshot = validateMetaPaidDirectSourceSnapshot(
    candidate,
    normalizeMetaPaidDirectUnits(unitRows()),
  );
  const dailyRows = snapshot.units
    .filter((unit) => unit.payload.datasetKey === 'meta_ads.performance.daily')
    .flatMap((unit) => unit.payload.rows);

  assert.equal(snapshot.sourceSummary.creativeRows, 1);
  assert.equal(snapshot.sourceSummary.dailyRows, 1);
  assert.deepEqual(dailyRows.map((row) => row.date_start), ['2026-07-15']);
});

test('historical source that does not cover all of July remains ineligible', () => {
  assert.throws(
    () => normalizeMetaPaidDirectCandidate(candidateRow(
      'meta_ads:chemistry_k2:meta-chemistry_k2-history-20260501-20260715-123456abcdef',
    ), 'chemistry_k2'),
    (error) => error?.code === 'META_PAID_DIRECT_LARK_SOURCE_INELIGIBLE',
  );
});
