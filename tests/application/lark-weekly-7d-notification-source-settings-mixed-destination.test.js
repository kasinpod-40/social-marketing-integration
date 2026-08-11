import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  resolveLarkWeekly7dNotificationSourceSettings,
} from '../../scripts/lib/lark-weekly-7d-notification-source-settings.js';

const GROUP_ID = 'reviewed-group';
const DESTINATION_HASH = createHash('sha256').update(GROUP_ID).digest('hex');
const WRONG_DESTINATION_HASH = createHash('sha256').update('different-group').digest('hex');

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

function resolve(expectedDestinationKeyHash) {
  return resolveLarkWeekly7dNotificationSourceSettings({
    sourceReportIds: ['report-a', 'report-b'],
    sourceAuthorities: [
      { reportId: 'report-a', reportSettingKey: 'setting-a' },
      { reportId: 'report-b', reportSettingKey: 'setting-b' },
    ],
    settings: [setting('setting-a', GROUP_ID), setting('setting-b', null)],
    expectedDestinationKeyHash,
  });
}

test('accepts reviewed configured subset with unset rows only when the configured hash is reviewed', () => {
  const authority = resolve(DESTINATION_HASH);
  assert.equal(authority.destinationBaseline, 'reviewed_with_unset');
  assert.equal(authority.configuredDestinationRowCount, 1);
  assert.equal(authority.unsetDestinationRowCount, 1);

  assert.throws(
    () => resolve(WRONG_DESTINATION_HASH),
    (error) => error.code === 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_DESTINATION_INVALID'
      && error.details.destinationCount === 1
      && error.details.configuredDestinationRows === 1
      && error.details.sourceSettingCount === 2,
  );
});
