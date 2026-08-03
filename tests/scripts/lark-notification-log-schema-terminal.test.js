import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  LARK_NOTIFICATION_LOG_APPLY_CONFIRMATION,
  LARK_NOTIFICATION_LOG_FIELDS,
  LARK_NOTIFICATION_LOG_TABLE_NAME,
  LARK_NOTIFICATION_LOG_VIEWS,
} from '../../packages/config/src/lark-notification-log-schema-contract.js';

test('plan-only terminal exposes one exact no-placeholder command and zero runtime actions', () => {
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/lark-notification-log-schema-terminal.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);

  assert.equal(output.ok, true);
  assert.equal(output.planOnly, true);
  assert.equal(output.tableName, LARK_NOTIFICATION_LOG_TABLE_NAME);
  assert.equal(output.iconMode, 'emoji_prefix_in_table_name');
  assert.equal(output.fieldCount, LARK_NOTIFICATION_LOG_FIELDS.length);
  assert.equal(output.viewCount, LARK_NOTIFICATION_LOG_VIEWS.length);
  assert.equal(output.viewFiltersConfigured, LARK_NOTIFICATION_LOG_VIEWS.length - 1);
  assert.match(output.exactCommand, /git switch main/u);
  assert.match(output.exactCommand, /git pull --ff-only origin main/u);
  assert.match(
    output.exactCommand,
    new RegExp(`CONFIRM_LARK_NOTIFICATION_LOG_SCHEMA=${LARK_NOTIFICATION_LOG_APPLY_CONFIRMATION}`, 'u'),
  );
  assert.match(output.exactCommand, /lark-notification-log-schema-terminal\.mjs --execute/u);
  assert.equal(output.exactCommand.includes('<'), false);
  assert.equal(output.exactCommand.includes('>'), false);
  assert.equal(output.deleteActionCount, 0);
  assert.equal(output.fieldTypeChangeCount, 0);
  assert.equal(output.optionRemovalCount, 0);
  assert.equal(output.recordReadCount, 0);
  assert.equal(output.recordWriteCount, 0);
  assert.equal(output.automationCount, 0);
  assert.equal(output.notificationCount, 0);
  assert.equal(output.webhookActionCount, 0);
  assert.equal(output.scheduleEnabled, false);
  assert.equal(output.production, 'BLOCKED');
  assert.equal(output.executed, false);
});
