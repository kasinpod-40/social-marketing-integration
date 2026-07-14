import { printJson } from './lib/lark-runtime.js';
import { resolveConfirmedApplyMode } from './lib/confirmed-apply-mode.js';
import {
  applyTikTokReportScheduleActivation,
  planTikTokReportScheduleActivation,
} from './lib/tiktok-report-schedule-config.js';

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    name: error?.name ?? 'Error',
    code: error?.code ?? 'UNEXPECTED_ERROR',
    retryable: error?.retryable === true,
    message: error?.message ?? String(error),
    details: error?.details ?? {},
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const filePath = readConfigArgument(process.argv.slice(2))
    ?? process.env.WRANGLER_SYNC_CONFIG
    ?? 'wrangler.sync.jsonc';
  const mode = resolveConfirmedApplyMode({
    argv: process.argv.slice(2),
    env: process.env,
    operationName: 'TikTok report schedule activation',
    confirmationErrorCode: 'TIKTOK_REPORT_SCHEDULE_WRITE_CONFIRMATION_REQUIRED',
    applyCommand: 'CONFIRM_WRITE=YES npm run enable:tiktok-report-schedules:apply',
  });

  if (!mode.apply) {
    const preview = await planTikTokReportScheduleActivation({ filePath });
    printJson({
      ...preview,
      nextCommand: preview.readyToApply && preview.actions.length > 0
        ? 'CONFIRM_WRITE=YES npm run enable:tiktok-report-schedules:apply'
        : null,
      note: preview.actions.length === 0
        ? 'Daily/Weekly report schedules เปิดอยู่แล้ว ไม่มีการแก้ไฟล์'
        : 'Preview mode เท่านั้น ยังไม่มีการแก้ wrangler.sync.jsonc',
      warning: mode.ignoredAmbientConfirmation
        ? 'พบ CONFIRM_WRITE=YES ใน Shell แต่ Preview command จะไม่แก้ไฟล์ ต้องใช้ enable:tiktok-report-schedules:apply เท่านั้น'
        : null,
    });
    return;
  }

  printJson(await applyTikTokReportScheduleActivation({ filePath }));
}

function readConfigArgument(argv) {
  const index = argv.indexOf('--config');
  if (index === -1) return null;
  const value = argv[index + 1];
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('--config requires a file path');
  return value.trim();
}
