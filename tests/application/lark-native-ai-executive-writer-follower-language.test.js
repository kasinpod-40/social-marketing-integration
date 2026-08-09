import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK,
  validateLarkNativeAiExecutiveWriterOutputs,
} from '../../packages/application/src/reports/lark-native-ai-executive-writer-quality.js';

const EVIDENCE = Object.freeze({
  businessEvidenceChannelCount: 1,
  comparisonEvidenceChannelCount: 1,
  businessEvidenceChannelNames: Object.freeze(['Facebook Organic']),
  summaryRequiredFacts: Object.freeze([
    Object.freeze({ channel: 'Facebook Organic', metric: 'followers', value: 181083 }),
  ]),
  derivedCtrFacts: Object.freeze([]),
});

function outputs(overrides = {}) {
  return {
    insight_summary: 'Facebook Organic มีผู้ติดตาม 181,083 คน',
    strengths: '',
    weaknesses: LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK,
    recommendations: '',
    ...overrides,
  };
}

test('follower noun in insight is not classified as a follow-up action', () => {
  const result = validateLarkNativeAiExecutiveWriterOutputs(outputs(), EVIDENCE);
  assert.equal(result.passed, true);
  assert.deepEqual(result.violations, []);
});

test('follower noun in weaknesses is not classified as a follow-up action', () => {
  const result = validateLarkNativeAiExecutiveWriterOutputs(outputs({
    weaknesses: 'Facebook Organic มีผู้ติดตามลดลง 5% เมื่อเทียบช่วงก่อน',
  }), EVIDENCE);
  assert.equal(result.passed, true);
  assert.deepEqual(result.violations, []);
});

test('real follow-up action in insight remains blocked', () => {
  const result = validateLarkNativeAiExecutiveWriterOutputs(outputs({
    insight_summary: 'Facebook Organic มีผู้ติดตาม 181,083 คน และติดตามผลสัปดาห์หน้า',
  }), EVIDENCE);
  assert.equal(result.passed, false);
  assert.ok(result.violations.includes('insight_contains_action'));
});

test('real follow-up action in weaknesses remains blocked', () => {
  const result = validateLarkNativeAiExecutiveWriterOutputs(outputs({
    weaknesses: 'Facebook Organic มีผู้ติดตามลดลง 5% และติดตามผลสัปดาห์หน้า',
  }), EVIDENCE);
  assert.equal(result.passed, false);
  assert.ok(result.violations.includes('weaknesses_contains_action'));
});
