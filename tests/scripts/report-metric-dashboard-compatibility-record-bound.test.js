import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES,
  inspectLarkDashboardCompatibilityFreeze,
} from '../../scripts/lib/lark-dashboard-compatibility-freeze-v1.js';

const TABLE_ID = 'tblMetric';
const ENV = Object.freeze({
  MKT_ENV: 'development',
  MKT_CUSTOMER_PROFILE: 'integration_workspace',
  LARK_TABLE_MKT_REPORT_METRIC_VALUES: TABLE_ID,
});
const WINDOW_PRESETS = Object.freeze([1, 3, 7, 30]);

test('Dashboard Compatibility Freeze admits the reviewed multichannel record footprint above 500', async () => {
  const compatibility = await inspectLarkDashboardCompatibilityFreeze({
    client: clientWithRecords(1_140),
    env: ENV,
  });

  assert.equal(compatibility.compatible, true);
  assert.equal(compatibility.recordCount, 1_140);
  assert.equal(compatibility.windowParityCount, 1_140);
  assert.equal(compatibility.blockerCount, 0);
});

test('Dashboard Compatibility Freeze remains bounded above 2000 records', async () => {
  const compatibility = await inspectLarkDashboardCompatibilityFreeze({
    client: clientWithRecords(2_001),
    env: ENV,
  });

  assert.equal(compatibility.compatible, false);
  assert.equal(compatibility.recordCount, 2_001);
  assert.equal(compatibility.blockerCount, 1);
  assert.equal(
    compatibility.blockers[0].code,
    'REPORT_METRIC_COMPATIBILITY_FREEZE_RECORD_BOUND_EXCEEDED',
  );
  assert.equal(compatibility.blockers[0].maxRecords, 2_000);
});

function clientWithRecords(recordCount) {
  const identities = LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES;
  const fields = [
    exactField(identities.metricKey),
    exactField(identities.displayName),
    exactField(identities.numberWindow, { formatter: '0' }),
    exactField(identities.preservedWindowSelect, {
      options: WINDOW_PRESETS.map((value) => ({ name: String(value) })),
    }),
    exactField(identities.windowSelectV2, {
      options: WINDOW_PRESETS.map((value) => ({ name: String(value) })),
    }),
    exactField(identities.displaySelectV1, { options: [] }),
    exactField(identities.displaySelectV2, { options: [] }),
  ];
  const records = Array.from({ length: recordCount }, (_, index) => {
    const windowDays = WINDOW_PRESETS[index % WINDOW_PRESETS.length];
    return {
      recordId: `rec${index + 1}`,
      fields: {
        metric_key: `metric-${index + 1}`,
        display_name: `Metric ${index + 1}`,
        window_days: windowDays,
        __mkt_legacy_window_days_single_select_v1: String(windowDays),
        __mkt_legacy_window_days_single_select_v2: null,
        __mkt_legacy_display_name_single_select_v1: null,
        __mkt_legacy_display_name_single_select_v2: null,
      },
    };
  });

  return {
    async listFields() {
      return structuredClone(fields);
    },
    async listRecords() {
      return structuredClone(records);
    },
  };
}

function exactField(identity, property = null) {
  return {
    fieldId: identity.fieldId,
    fieldName: identity.fieldName,
    type: identity.type,
    isPrimary: identity.isPrimary,
    property,
  };
}
