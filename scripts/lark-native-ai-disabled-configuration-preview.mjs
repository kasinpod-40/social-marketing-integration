#!/usr/bin/env node

import {
  buildLarkNativeAiDisabledConfigurationPreview,
  validateLarkNativeAiDisabledConfigurationPreview,
} from '../packages/application/src/reports/build-lark-native-ai-disabled-configuration-preview.js';

const unknownArguments = process.argv.slice(2);
if (unknownArguments.length > 0) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: 'LARK_NATIVE_AI_DISABLED_CONFIGURATION_PREVIEW_ARGUMENT_UNSUPPORTED',
    arguments: unknownArguments,
  }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  const preview = await buildLarkNativeAiDisabledConfigurationPreview(buildFixture());
  const blockers = validateLarkNativeAiDisabledConfigurationPreview(preview);
  if (blockers.length > 0) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: 'LARK_NATIVE_AI_DISABLED_CONFIGURATION_PREVIEW_INVALID',
      blockerCount: blockers.length,
      blockers,
    }, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify({
      ...preview,
      exactCommand: 'node scripts/lark-native-ai-disabled-configuration-preview.mjs',
      generatedLocally: true,
      remoteActionCount: 0,
    }, null, 2)}\n`);
  }
}

function buildFixture() {
  return Object.freeze({
    aiRun: Object.freeze({
      aiRunKey: 'integration_workspace:executive:7d:2026-08-03',
      reportId: 'integration_workspace:executive:7d:2026-08-03',
      scopeType: 'executive',
      windowDays: 7,
      generationStatus: 'generated',
      readinessStatus: 'report_partial',
      severity: 'warning',
      notificationEligible: true,
      previewMode: false,
      sentToGroup: false,
      dedupeKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      insightSummary: 'ภาพรวมมีข้อมูลพร้อมใช้งานบางส่วน โดยช่องทางที่ยังไม่ครบต้องคงสถานะเตือนและไม่นำมาสรุปเป็นศูนย์',
      strengths: 'ข้อมูลที่ผ่านการตรวจสอบยังรักษา Stable key, ช่วงเวลา และ Coverage ตาม Report กลาง',
      weaknesses: 'บางช่องทางยังไม่มี Report ที่ครบถ้วน จึงยังไม่ควรสรุปแนวโน้มข้ามช่องทาง',
      recommendations: 'ใช้เฉพาะข้อมูลที่ผ่านการตรวจสอบในการตัดสินใจ และรอ Coverage ครบก่อนเปิดการส่งอัตโนมัติ',
    }),
    snapshot: Object.freeze({
      reportId: 'integration_workspace:executive:7d:2026-08-03',
      reportSettingKey: 'integration_workspace:executive:rolling:7',
      customerProfile: 'integration_workspace',
      periodStart: '2026-07-28',
      periodEnd: '2026-08-03',
    }),
    settings: Object.freeze({
      reportSettingKey: 'integration_workspace:executive:rolling:7',
      customerProfile: 'integration_workspace',
      enabled: true,
      notificationEnabled: true,
      destinationKeyHash: '7e69a1721915dfc52b4a3ed1ecf2569cdac63ffa63f6419959c35562ef5219b9',
    }),
  });
}
