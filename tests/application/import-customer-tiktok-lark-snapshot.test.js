import test from 'node:test';
import assert from 'node:assert/strict';
import { createStableFingerprint } from '../../packages/shared/src/hash/stable-fingerprint.js';
import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../packages/shared/src/date/date-time.js';
import {
  CUSTOMER_TIKTOK_LARK_SNAPSHOT_ID,
  importCustomerTikTokLarkSnapshot,
  listCustomerTikTokLarkImportContracts,
} from '../../packages/application/src/use-cases/import-customer-tiktok-lark-snapshot.js';

test('Customer TikTok import accepts one exact insert-only Daily batch', async () => {
  const metricDate = dateOnlyInTimeZoneToEpochMilliseconds('2026-08-27', 'Asia/Bangkok');
  const rows = Array.from({ length: 50 }, (_, index) => ({
    content_daily_key: `tiktok:chemistry_k:${1000 + index}:2026-08-27`,
    platform: 'tiktok',
    account_id: 'chemistry_k',
    external_content_id: String(1000 + index),
    metric_date: metricDate,
    views: index,
  }));
  const fingerprint = await createStableFingerprint(rows);
  const contract = listCustomerTikTokLarkImportContracts().mktContentDaily;
  const engine = {
    async planByKey(input) {
      assert.equal(input.keyField, 'content_daily_key');
      assert.equal(input.rows.length, 50);
      return { duplicateInputRows: 0, updateRows: [] };
    },
    async executePlan() { return { created: 50, updated: 0, skipped: 0, duplicateInputRows: 0 }; },
  };
  const result = await importCustomerTikTokLarkSnapshot({
    body: {
      snapshotId: CUSTOMER_TIKTOK_LARK_SNAPSHOT_ID,
      tableKey: 'mktContentDaily',
      batchIndex: 0,
      batchCount: contract.batchCount,
      totalRows: contract.totalRows,
      batchFingerprint: fingerprint,
      rows,
    },
    repository: {},
    syncEngine: engine,
    tables: { mktContentDaily: 'tbl_daily' },
    allowedFingerprints: {
      mktContentDaily: [fingerprint, ...Array.from({ length: contract.batchCount - 1 }, () => 'unused')],
    },
  });
  assert.equal(result.reconciliation[0].created, 50);
});

test('Customer TikTok import rejects Business updates and a changed fingerprint', async () => {
  const row = {
    content_key: 'tiktok:chemistry_k:1000',
    platform: 'tiktok',
    account_id: 'chemistry_k',
    external_content_id: '1000',
  };
  const fingerprint = await createStableFingerprint([row]);
  const body = {
    snapshotId: CUSTOMER_TIKTOK_LARK_SNAPSHOT_ID,
    tableKey: 'mktContent',
    batchIndex: 0,
    batchCount: 1,
    totalRows: 2,
    batchFingerprint: fingerprint,
    rows: [row, { ...row, content_key: 'tiktok:chemistry_k:1001', external_content_id: '1001' }],
  };
  const exact = await createStableFingerprint(body.rows);
  body.batchFingerprint = exact;
  await assert.rejects(importCustomerTikTokLarkSnapshot({
    body,
    repository: {},
    syncEngine: {
      async planByKey() { return { duplicateInputRows: 0, updateRows: [{}] }; },
      async executePlan() { throw new Error('must not write'); },
    },
    tables: { mktContent: 'tbl_content' },
    allowedFingerprints: { mktContent: [exact] },
  }), (error) => error.code === 'CUSTOMER_TIKTOK_LARK_IMPORT_INVALID');

  await assert.rejects(importCustomerTikTokLarkSnapshot({
    body: { ...body, batchFingerprint: fingerprint },
    repository: {},
    syncEngine: {},
    tables: { mktContent: 'tbl_content' },
    allowedFingerprints: { mktContent: [exact] },
  }), (error) => error.code === 'CUSTOMER_TIKTOK_LARK_IMPORT_INVALID');
});
