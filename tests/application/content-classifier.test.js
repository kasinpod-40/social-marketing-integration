import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMarketingContent } from '../../packages/application/src/services/content-classifier.js';

test('classifies Chemistry K summary content for course reporting fields', () => {
  const result = classifyMarketingContent({
    caption: 'ม.4 เซฟเก็บไว้เลย! สรุปครบจบเรื่องธาตุกัมมันตรังสี #สอวนเคมี ดูเพิ่มที่ chemistryk.com',
  });

  assert.deepEqual(result.course_level, ['ม.4', 'สอวน']);
  assert.equal(result.content_theme, 'สรุปเนื้อหา');
  assert.equal(result.funnel_stage, 'awareness');
  assert.equal(result.cta_type, 'website');
  assert.equal(result.cta_destination, 'chemistryk.com');
  assert.equal(result.classification_source, 'rule');
  assert.ok(result.classification_confidence >= 0.6);
});

test('classifies deadline promotion as conversion content', () => {
  const result = classifyMarketingContent({
    caption: 'รับสมัครติวฟรี วันสุดท้าย สมัครเลยผ่าน LINE @Chemistry_k',
  });

  assert.equal(result.course_type, 'free_trial');
  assert.equal(result.content_theme, 'ปิดรับสมัคร');
  assert.equal(result.funnel_stage, 'conversion');
  assert.equal(result.cta_type, 'line');
  assert.equal(result.promotion_type, 'deadline');
  assert.equal(result.urgency_level, 'high');
});
