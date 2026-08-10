import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  resolveLarkWeekly7dNotificationSourceSettings,
} from '../../scripts/lib/lark-weekly-7d-notification-source-settings.js';

const GROUP_ID = 'reviewed-group';
const DESTINATION_HASH = createHash('sha256').update(GROUP_ID).digest('hex');

function snapshot(reportId, settingKey) {
  return {
    recordId: `snapshot-${reportId}`,
    fields: {
      report_id: reportId,
      report_setting_key: settingKey,
      customer_profile: 'integration_workspace',
    },
  };
}

function setting(settingKey, groupId) {
  return {
    recordId: `setting-${settingKey}`,
    fields: {
      report_setting_key: settingKey,
      customer_profile: 'integration_workspace',
      enabled: true,
      ai_enabled: false,
      notification_enabled: false,
      group_id: groupId,
    },
  };
}

test('rejects mixed null and configured group_id even when the configured hash is reviewed', () => {
  assert.throws(
    () => resolveLarkWeekly7dNotificationSourceSettings({
      sourceReportIds: ['report-a', 'report-b'],
      snapshots: [snapshot('report-a', 'setting-a'), snapshot('report-b', 'setting-b')],
      settings: [setting('setting-a', GROUP_ID), setting('setting-b', null)],
      expectedDestinationKeyHash: DESTINATION_HASH,
    }),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_DESTINATION_INVALID'
      && error.details.configuredDestinationRows === 1
      && error.details.sourceSettingCount === 2,
  );
});
