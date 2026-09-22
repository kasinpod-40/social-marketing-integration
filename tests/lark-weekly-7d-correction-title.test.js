import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLarkExecutiveNotificationMessage,
} from '../packages/application/src/notifications/deliver-lark-executive-notification.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const WEEKLY_TEMPLATE = 'executive_weekly_7d_notification_v1';

function request(aiRunKey) {
  return {
    aiRun: {
      aiRunKey,
      reportId: aiRunKey,
      templateVersion: WEEKLY_TEMPLATE,
      scopeType: 'executive',
      generationStatus: 'generated',
      notificationEligible: true,
      previewMode: false,
      sentToGroup: false,
      dedupeKey: HASH_A,
      windowDays: 7,
      readinessStatus: 'report_available',
      severity: 'info',
      insightSummary: 'สรุปข้อเท็จจริง',
      strengths: 'จุดเด่น',
      weaknesses: 'จุดที่ต้องจับตา',
      recommendations: 'สิ่งที่ควรทำต่อ',
    },
    snapshot: {
      reportId: aiRunKey,
      reportSettingKey: 'weekly-7d-setting',
      customerProfile: 'chemistry_k',
      periodStart: '2026-09-14',
      periodEnd: '2026-09-20',
    },
    settings: {
      enabled: true,
      aiEnabled: true,
      notificationEnabled: true,
      groupId: 'oc_test_group',
      destinationKeyHash: HASH_B,
    },
  };
}

test('one-time full-channel weekly correction is visibly labelled as corrected', () => {
  const aiRunKey = `notification-weekly-7d:full-channel:${'c'.repeat(64)}`;
  const message = buildLarkExecutiveNotificationMessage(request(aiRunKey));

  assert.equal(message.title, '📊 Social MKT Weekly Executive Report — 7D (ฉบับแก้ไข)');
  assert.ok(message.text.startsWith('📊 Social MKT Weekly Executive Report — 7D (ฉบับแก้ไข)\n'));
});

test('normal weekly report title is unchanged', () => {
  const aiRunKey = `weekly-7d-executive-decision-ai:${'d'.repeat(64)}`;
  const message = buildLarkExecutiveNotificationMessage(request(aiRunKey));

  assert.equal(message.title, '📊 Social MKT Weekly Executive Report — 7D');
  assert.ok(!message.text.includes('(ฉบับแก้ไข)'));
});
