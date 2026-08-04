import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const migration = readFileSync('migrations/0019_lark_notification_delivery.sql', 'utf8');

test('migration 0019 creates replay-safe notification delivery authority', () => {
  const db = createSqliteD1();
  try {
    db.exec(migration);
    db.exec(migration);
    const columns = db.database.prepare(
      'PRAGMA table_info(lark_notification_deliveries)',
    ).all().map((row) => row.name);
    assert.deepEqual(columns, [
      'notification_attempt_key', 'ai_run_key', 'dedupe_key', 'report_id',
      'report_setting_key', 'customer_profile', 'destination_key_hash',
      'template_version', 'payload_checksum', 'status', 'claim_owner',
      'lease_expires_at', 'claim_count', 'attempted_at', 'sent_at',
      'lark_message_id_hash', 'mirror_status', 'mirrored_at', 'error_code',
      'redacted_error_message', 'created_at', 'updated_at',
    ]);
    const indexes = db.database.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='lark_notification_deliveries'",
    ).all().map((row) => row.name);
    assert.ok(indexes.includes('idx_lark_notification_delivery_status_lease'));
    assert.ok(indexes.includes('idx_lark_notification_delivery_ai_run'));
    assert.ok(indexes.includes('idx_lark_notification_delivery_mirror'));
  } finally {
    db.close();
  }
});
