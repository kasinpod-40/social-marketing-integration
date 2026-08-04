import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deliverLarkExecutiveNotification } from '../../packages/application/src/notifications/deliver-lark-executive-notification.js';
import { D1LarkNotificationDeliveryStore } from '../../packages/connectors/src/lark/d1-lark-notification-delivery-store.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const migration = readFileSync('migrations/0019_lark_notification_delivery.sql', 'utf8');
const destinationHash = '7e69a1721915dfc52b4a3ed1ecf2569cdac63ffa63f6419959c35562ef5219b9';
const dedupeKey = 'a'.repeat(64);

function request() {
  return {
    aiRun: {
      aiRunKey: 'integration_workspace:executive:7d:2026-08-03',
      reportId: 'integration_workspace:executive:7d:2026-08-03',
      scopeType: 'executive', generationStatus: 'generated', notificationEligible: true,
      previewMode: false, sentToGroup: false, dedupeKey, windowDays: 7,
      readinessStatus: 'report_partial', severity: 'warning',
      insightSummary: 'ภาพรวมมีข้อมูลพร้อมใช้งานบางส่วน',
      strengths: 'มีข้อมูลที่ผ่านการตรวจสอบแล้ว',
      weaknesses: 'บางช่องทางยังไม่มีข้อมูลครบ',
      recommendations: 'รอข้อมูลครบก่อนตัดสินใจ',
    },
    snapshot: {
      reportId: 'integration_workspace:executive:7d:2026-08-03',
      reportSettingKey: 'integration_workspace:executive:rolling:7',
      customerProfile: 'integration_workspace', periodStart: '2026-07-28', periodEnd: '2026-08-03',
    },
    settings: {
      enabled: true, aiEnabled: true, notificationEnabled: true,
      groupId: 'runtime-destination', destinationKeyHash: destinationHash,
    },
  };
}
function setup() {
  const db = createSqliteD1();
  db.exec(migration);
  let clock = 1_000;
  return {
    db,
    store: new D1LarkNotificationDeliveryStore({ db, now: () => clock++ }),
    now: () => clock++,
  };
}

test('sends and mirrors once while exact replay never sends again', async () => {
  const state = setup();
  let sends = 0;
  let mirrors = 0;
  try {
    const base = {
      request: request(), store: state.store, now: state.now,
      transport: { async sendTextToChat() { sends += 1; return { messageId: 'message-1' }; } },
      async mirrorDelivery(row) {
        mirrors += 1;
        assert.equal(row.attempt_status, 'sent');
        assert.match(row.payload_checksum, /^[a-f0-9]{64}$/u);
      },
    };
    const first = await deliverLarkExecutiveNotification({ ...base, ownerId: 'operation-1' });
    const replay = await deliverLarkExecutiveNotification({ ...base, ownerId: 'operation-2' });
    assert.equal(first.status, 'sent_and_mirrored');
    assert.equal(replay.status, 'deduped_sent');
    assert.equal(sends, 1);
    assert.equal(mirrors, 1);
  } finally { state.db.close(); }
});

test('a failed mirror is repaired without another message send', async () => {
  const state = setup();
  let sends = 0;
  let mirrors = 0;
  try {
    const base = {
      request: request(), store: state.store, now: state.now,
      transport: { async sendTextToChat() { sends += 1; return { messageId: 'message-1' }; } },
    };
    await assert.rejects(
      () => deliverLarkExecutiveNotification({
        ...base, ownerId: 'operation-1',
        async mirrorDelivery() { mirrors += 1; throw new Error('mirror unavailable'); },
      }),
      (error) => error.code === 'LARK_NOTIFICATION_LOG_MIRROR_FAILED',
    );
    const repaired = await deliverLarkExecutiveNotification({
      ...base, ownerId: 'operation-2', async mirrorDelivery() { mirrors += 1; },
    });
    assert.equal(repaired.status, 'deduped_sent_mirror_repaired');
    assert.equal(sends, 1);
    assert.equal(mirrors, 2);
  } finally { state.db.close(); }
});

test('an unknown delivery outcome blocks every replay', async () => {
  const state = setup();
  let sends = 0;
  try {
    await assert.rejects(
      () => deliverLarkExecutiveNotification({
        request: request(), ownerId: 'operation-1', store: state.store, now: state.now,
        transport: { async sendTextToChat() { sends += 1; throw new Error('outcome unknown'); } },
      }),
      (error) => error.code === 'LARK_NOTIFICATION_DELIVERY_OUTCOME_UNKNOWN',
    );
    const replay = await deliverLarkExecutiveNotification({
      request: request(), ownerId: 'operation-2', store: state.store, now: state.now,
      transport: { async sendTextToChat() { sends += 1; return { messageId: 'unexpected' }; } },
    });
    assert.equal(replay.messageSendCount, 0);
    assert.equal(sends, 1);
  } finally { state.db.close(); }
});
