import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const path = 'scripts/lib/lark-weekly-7d-fresh-decision-notification-source.js';
const source = await readFile(path, 'utf8');

test('weekly Notification source is anchored to the accepted retained Fresh v4 identity', () => {
  assert.match(source, /24ed4cbae0a92e6dd89e850833056ca411781275c53fa9f8d7577c99a3d9c861/u);
  assert.match(source, /repository\.listByFieldValues\([\s\S]*?'scope_type',[\s\S]*?\[SOURCE_SCOPE\]/u);
  assert.match(source, /sha256\(key\) === LARK_WEEKLY_7D_NOTIFICATION_LOCKED_SOURCE_AI_RUN_KEY_SHA256/u);
  assert.doesNotMatch(source, /collectLarkNativeAiWeekly7dControlledUatSource/u);
  assert.doesNotMatch(source, /buildLarkWeekly7dExecutiveDecisionSynthesis/u);
});

test('weekly Notification source rebuilds evidence from the retained source Report IDs', () => {
  assert.match(source, /loadRetainedWeeklyFactualReport/u);
  assert.match(source, /sourceReportIds: sourceAuthority\.sourceReportIds/u);
  assert.match(source, /buildLarkWeeklyExecutiveFullChannelAiEvidence/u);
  assert.match(source, /rebuiltEvidence\.metricSummaryJson !== sourceAuthority\.metricSummaryJson/u);
  assert.match(source, /LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_EVIDENCE_DRIFT/u);
});

test('weekly Notification source hard-gates the exact reviewed message before destination admission', () => {
  assert.match(source, /6b8a2f1d2243c0bb2575082afb4e5ea7a530e8d16de31a02ee666fcf27da2a5f/u);
  const messageGate = source.indexOf('LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_SHA256');
  const destination = source.indexOf('resolveLarkNotificationReviewedDestination');
  assert.ok(messageGate >= 0);
  assert.ok(destination > messageGate);
  assert.match(source, /LARK_WEEKLY_7D_NOTIFICATION_REVIEWED_MESSAGE_DRIFT/u);
});
