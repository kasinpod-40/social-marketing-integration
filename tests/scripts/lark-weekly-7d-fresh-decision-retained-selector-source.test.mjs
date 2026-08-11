import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourcePath = 'scripts/lib/lark-weekly-7d-fresh-decision-notification-source.js';
const evidencePath = 'scripts/lib/lark-weekly-7d-retained-decision-evidence.js';
const deliveryPath = 'packages/connectors/src/lark/lark-notification-delivery-source.js';
const source = await readFile(sourcePath, 'utf8');
const evidence = await readFile(evidencePath, 'utf8');
const delivery = await readFile(deliveryPath, 'utf8');

test('weekly Notification source is anchored to accepted retained Fresh v4 evidence', () => {
  assert.match(evidence, /24ed4cbae0a92e6dd89e850833056ca411781275c53fa9f8d7577c99a3d9c861/u);
  assert.match(evidence, /a732d4c4790ef99261e23e6a129a38822e9268a1f478387dfc2e82126b8a6fea/u);
  assert.match(evidence, /decision-preview-summary\.json/u);
  assert.match(evidence, /source_report_checksum/u);
  assert.match(evidence, /resolveDashboardReportSourceAuthority/u);
  assert.doesNotMatch(evidence, /reportSnapshots|searchRecordsByFieldValues/u);
  assert.match(source, /loadLockedFreshWeekly7dDecisionEvidence/u);
  assert.doesNotMatch(source, /loadRetainedWeeklyFactualReport|collectLarkNativeAiWeekly7dControlledUatSource/u);
});

test('weekly Notification source preserves the exact reviewed message as immutable delivery authority', () => {
  assert.match(evidence, /6b8a2f1d2243c0bb2575082afb4e5ea7a530e8d16de31a02ee666fcf27da2a5f/u);
  assert.match(evidence, /LOCKED_REVIEWED_MESSAGE_BYTES = 4118/u);
  assert.match(source, /extractRetainedOverviewBody/u);
  assert.match(source, /buildLarkExecutiveNotificationMessage/u);
  assert.match(source, /message\.text !== authority\.retainedMessage/u);
  assert.match(source, /deliveryOutputsSha256/u);
});

test('weekly dedicated Worker delivery is snapshotless while historical delivery retains its Snapshot path', () => {
  assert.match(delivery, /isSnapshotlessWeekly7d/u);
  assert.match(delivery, /resolveDashboardReportSourceAuthority/u);
  assert.match(delivery, /loadSnapshotSourceAuthority/u);
  assert.match(delivery, /tables\.reportSnapshots/u);
  const weeklyStart = delivery.indexOf('function normalizeWeekly7dSourceAuthority');
  const weeklyEnd = delivery.indexOf('async function findExact', weeklyStart);
  assert.ok(weeklyStart >= 0 && weeklyEnd > weeklyStart);
  assert.doesNotMatch(delivery.slice(weeklyStart, weeklyEnd), /reportSnapshots|findExactMany/u);
});
