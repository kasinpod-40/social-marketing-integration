import test from 'node:test';
import assert from 'node:assert/strict';
import { planMktContentDailyRetention } from '../../scripts/lib/mkt-content-daily-retention.js';

const day = (value) => Date.parse(`${value}T00:00:00+07:00`);
const row = (recordId, content, date) => ({
  recordId,
  fields: {
    content_daily_key: `tiktok:chemistry_k:${content}:${date}`,
    platform: 'tiktok', account_id: 'chemistry_k', external_content_id: content,
    metric_date: day(date),
  },
});

test('keeps thirty completed source days and the latest row for every content', () => {
  const plan = planMktContentDailyRetention({ records: [
    row('old-a', 'a', '2026-06-01'), row('recent-a', 'a', '2026-08-10'),
    row('only-b', 'b', '2026-06-01'), row('max-c', 'c', '2026-08-15'),
  ] });
  assert.equal(plan.deleteCandidateCount, 1);
  assert.equal(plan.deletes[0].recordId, 'old-a');
  assert.equal(plan.retainedCount, 3);
  assert.equal(plan.contentIdentityCount, 3);
  assert.equal(plan.effectiveRetentionDays, 30);
});

test('shrinks the cache window until retained rows fit the reviewed bound', () => {
  const records = [];
  for (let date = 1; date <= 6; date += 1) {
    for (let content = 1; content <= 3; content += 1) {
      records.push(row(`r-${date}-${content}`, String(content), `2026-08-${String(date).padStart(2, '0')}`));
    }
  }
  const plan = planMktContentDailyRetention({ records, maxRetainedRecords: 10 });
  assert.equal(plan.effectiveRetentionDays, 3);
  assert.equal(plan.retainedCount, 9);
  assert.equal(plan.deleteCandidateCount, 9);
});

test('preserves malformed or unmanaged rows instead of deleting by inference', () => {
  const plan = planMktContentDailyRetention({ records: [
    row('valid', 'a', '2026-08-15'), { recordId: 'manual', fields: { metric_date: day('2026-01-01') } },
  ] });
  assert.equal(plan.unmanagedPreservedCount, 1);
  assert.equal(plan.deleteCandidateCount, 0);
});

test('fails closed on duplicate stable keys', () => {
  const duplicate = row('two', 'a', '2026-08-15');
  duplicate.fields.content_daily_key = row('one', 'a', '2026-08-15').fields.content_daily_key;
  assert.throws(
    () => planMktContentDailyRetention({ records: [row('one', 'a', '2026-08-15'), duplicate] }),
    (error) => error?.code === 'MKT_CONTENT_DAILY_RETENTION_DUPLICATE_KEY',
  );
});

test('fails closed when latest-per-content rows alone exceed the reviewed bound', () => {
  assert.throws(
    () => planMktContentDailyRetention({
      records: [
        row('one', 'one', '2026-08-15'),
        row('two', 'two', '2026-08-15'),
        row('three', 'three', '2026-08-15'),
      ],
      maxRetainedRecords: 2,
    }),
    (error) => error?.code === 'MKT_CONTENT_DAILY_RETENTION_BOUND_UNSATISFIABLE',
  );
});
