import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLarkBaseCloneCanonicalParity } from '../../packages/application/src/use-cases/verify-lark-base-clone-canonical-parity.js';

const text = (fieldId, fieldName, primary = false) => ({
  fieldId,
  fieldName,
  type: 1,
  uiType: 'Text',
  description: '',
  isPrimary: primary,
  property: null,
});

const number = (fieldId, fieldName, formatter) => ({
  fieldId,
  fieldName,
  type: 2,
  uiType: 'Number',
  description: '',
  isPrimary: false,
  property: { formatter },
});

class NumberReadClient {
  constructor({ tableId, windowDays, coverageRate }) {
    this.tableId = tableId;
    this.windowDays = windowDays;
    this.coverageRate = coverageRate;
  }

  async listTables() {
    return [{ tableId: this.tableId, name: '📣 MKT_Report_Top_Ads' }];
  }

  async listFields() {
    return [
      text(`${this.tableId}_key`, 'report_key', true),
      number(`${this.tableId}_window`, 'window_days', '0'),
      number(`${this.tableId}_coverage`, 'coverage_rate', '0.00%'),
    ];
  }

  async listRecords() {
    return [{
      recordId: `${this.tableId}_record`,
      fields: {
        report_key: 'integration_workspace:google_ads:rolling:30d:chemistry_k',
        window_days: this.windowDays,
        coverage_rate: this.coverageRate,
      },
    }];
  }

  async listViews() {
    return [{
      viewId: `${this.tableId}_view`,
      viewName: 'All',
      viewType: 'grid',
      publicLevel: 'Public',
      property: { hiddenFields: [], filterInfo: null },
    }];
  }

  async getView({ viewId }) {
    return {
      viewId,
      viewName: 'All',
      viewType: 'grid',
      publicLevel: 'Public',
      property: { hiddenFields: [], filterInfo: null },
    };
  }
}

test('canonical verifier accepts Number readback numeric strings as the same Lark value', async () => {
  const sourceClient = new NumberReadClient({
    tableId: 'src_top_ads',
    windowDays: 30,
    coverageRate: 0.875,
  });
  const targetClient = new NumberReadClient({
    tableId: 'target_top_ads',
    windowDays: '30',
    coverageRate: '0.875',
  });

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['📣 MKT_Report_Top_Ads'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.mismatches, 0);
  assert.equal(result.remoteMutationCount, 0);
});

test('canonical verifier still fails closed for a non-numeric Number readback', async () => {
  const sourceClient = new NumberReadClient({
    tableId: 'src_top_ads',
    windowDays: 30,
    coverageRate: 0.875,
  });
  const targetClient = new NumberReadClient({
    tableId: 'target_top_ads',
    windowDays: 'thirty',
    coverageRate: '0.875',
  });

  const result = await verifyLarkBaseCloneCanonicalParity({
    sourceClient,
    targetClient,
    expectedTableNames: ['📣 MKT_Report_Top_Ads'],
  });

  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((item) => (
    item.code === 'CANONICAL_VERIFY_RECORD_VALUE_MISMATCH'
      && item.message.includes('window_days')
  )));
  assert.equal(result.remoteMutationCount, 0);
});
