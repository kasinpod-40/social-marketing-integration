#!/usr/bin/env node

import {
  buildLarkExecutiveNotificationSafeDeliveryPreview,
  validateLarkExecutiveNotificationSafeDeliveryPreview,
} from '../packages/application/src/notifications/build-lark-executive-notification-safe-delivery-preview.js';

const args = process.argv.slice(2);
if (args.length > 0) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: 'LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_ARGUMENT_UNSUPPORTED',
    arguments: args,
  }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  const preview = buildLarkExecutiveNotificationSafeDeliveryPreview();
  const blockers = validateLarkExecutiveNotificationSafeDeliveryPreview(preview);
  if (blockers.length > 0) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: 'LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_PREVIEW_INVALID',
      blockerCount: blockers.length,
      blockers,
    }, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify({
      ...preview,
      exactCommand: 'node scripts/lark-executive-notification-safe-delivery-preview.mjs',
      generatedLocally: true,
      remoteActionCount: 0,
    }, null, 2)}\n`);
  }
}
