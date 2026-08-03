#!/usr/bin/env node

const platformScope = String(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE ?? 'tiktok',
).trim().toLowerCase();

if (platformScope === 'youtube') {
  await import('./report-runtime-closeout-reviewed-multiwindow.mjs');
} else {
  await import('./report-runtime-closeout-legacy.mjs');
}
