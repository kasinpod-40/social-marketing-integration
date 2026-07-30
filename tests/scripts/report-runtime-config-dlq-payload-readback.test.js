import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT,
  buildReportRuntimeConfigDlqRetryStateSql,
} from '../../scripts/lib/report-runtime-config-dlq-recovery.js';

test('config-DLQ retry readback includes the exact materialization payload used by Lark integrity verification', () => {
  const sql = buildReportRuntimeConfigDlqRetryStateSql(1785392000000);
  assert.match(
    sql,
    new RegExp(`SELECT payload_json FROM report_materializations WHERE report_id = '${REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_INCIDENT.reportId}'`, 'u'),
  );
  assert.match(sql, /AS payload_json/u);
  assert.match(sql, /AS payload_checksum/u);
  assert.match(sql, /AS successful_sync_count/u);
  assert.match(sql, /AS new_dlq_count/u);
});
