import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateLarkNativeAiExecutiveWriterOutputs,
} from '../../packages/application/src/reports/lark-native-ai-executive-writer-quality.js';

const evidence = Object.freeze({
  businessEvidenceChannelCount: 2,
  businessEvidenceChannelNames: ['Meta Ads', 'WooCommerce'],
  comparisonEvidenceChannelCount: 2,
  recommendationMode: 'cross_channel_business_followup',
  summaryRequiredFacts: [],
  derivedCtrFacts: [],
});

const baseOutputs = Object.freeze({
  insight_summary: 'Meta Ads มีการแสดงผล 3,025,762 ครั้ง และ WooCommerce มียอดขายสุทธิ 168,010 หน่วยเงิน',
  strengths: 'Meta Ads มีการแสดงผลเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
  weaknesses: 'WooCommerce มียอดขายสุทธิลดลงเมื่อเทียบกับช่วงก่อน',
});

test('cross-channel business analysis is not classified as Data Ops', () => {
  const result = validateLarkNativeAiExecutiveWriterOutputs({
    ...baseOutputs,
    recommendations: '1. ติดตามผลลัพธ์การตลาดที่ส่งผลต่อยอดขายรวมและยอดขายสุทธิของ WooCommerce เพื่อหาความสัมพันธ์กับช่องทางอื่นที่มีข้อมูล',
  }, evidence);

  assert.deepEqual(result, { passed: true, violations: [] });
});

test('recommendation quality still blocks actual Data Ops follow-up', () => {
  const result = validateLarkNativeAiExecutiveWriterOutputs({
    ...baseOutputs,
    recommendations: '1. รอข้อมูลจากช่องทางอื่นให้ครบก่อนวิเคราะห์ต่อ',
  }, evidence);

  assert.equal(result.passed, false);
  assert.ok(result.violations.includes('recommendations_contains_data_ops'));
});
