import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMarketingContent } from '../../packages/application/src/services/content-classifier.js';
import { mapClassificationDictionaryRecords } from '../../packages/application/src/services/classification-dictionary.js';

const DICTIONARY_RULES = mapClassificationDictionaryRecords([
  row('course_level_m4', 'course_level', 'ม.4', 'ม.4, ม4, m.4, m4', 'contains', 'facebook,instagram,tiktok,youtube', 'organic', 100, 95),
  row('course_level_olympiad', 'course_level', 'สอวน', 'สอวน, สอวน.เคมี, olympiad', 'contains', 'facebook,instagram,tiktok,youtube', 'organic', 100, 95),
  row('theme_summary', 'content_theme', 'สรุปเนื้อหา', 'สรุป, เซฟเก็บไว้, ทบทวน, ตารางธาตุ, ชีท, short note', 'contains', 'facebook,instagram,tiktok,youtube', 'organic', 80, 85),
  row('funnel_awareness', 'funnel_stage', 'awareness', 'สรุป, สอนฟรี, เซฟเก็บไว้, ความรู้, ตารางธาตุ, เคมีมปลาย', 'contains', 'facebook,instagram,tiktok,youtube', 'organic', 60, 75),
  row('cta_website', 'cta_type', 'website', 'http, https, www., chemistryk.com, เว็บไซต์, เว็บ', 'contains', 'facebook,instagram,tiktok,youtube', 'organic', 80, 85),
  row('theme_deadline', 'content_theme', 'ปิดรับสมัคร', 'ปิดรับสมัคร, วันสุดท้าย, หมดเขต, โอกาสสุดท้าย, last chance', 'contains', 'facebook,instagram,tiktok,youtube,meta_ads,tiktok_ads,google_ads', 'both', 100, 95),
  row('course_type_free_trial', 'course_type', 'free_trial', 'ติวฟรี, เรียนฟรี, ทดลองเรียน, free trial, free class', 'contains', 'facebook,instagram,tiktok,youtube', 'organic', 100, 95),
  row('funnel_conversion', 'funnel_stage', 'conversion', 'สมัคร, ลงทะเบียน, ปิดรับสมัคร, วันสุดท้าย, หมดเขต, จ่าย, ซื้อ, รับสมัคร', 'contains', 'facebook,instagram,tiktok,youtube', 'organic', 100, 90),
  row('cta_line', 'cta_type', 'line', 'line, lin.ee, @chemistry, ไลน์', 'contains', 'facebook,instagram,tiktok,youtube', 'organic', 100, 95),
  row('promotion_deadline', 'promotion_type', 'deadline', 'วันสุดท้าย, ปิดรับสมัคร, หมดเขต, deadline, last chance', 'contains', 'facebook,instagram,tiktok,youtube', 'organic', 100, 95),
  row('urgency_high', 'urgency_level', 'high', 'วันสุดท้าย, ปิดรับสมัคร, หมดเขต, โอกาสสุดท้าย, last chance, ด่วน', 'contains', 'facebook,instagram,tiktok,youtube', 'organic', 100, 95),
]);

test('classifies content by client-editable Lark dictionary rules', () => {
  const result = classifyMarketingContent({
    caption: 'ม.4 เซฟเก็บไว้เลย! สรุปครบจบเรื่องธาตุกัมมันตรังสี #สอวนเคมี ดูเพิ่มที่ chemistryk.com',
    platform: 'tiktok',
    appliesTo: 'organic',
    dictionaryRules: DICTIONARY_RULES,
  });

  assert.deepEqual(result.course_level, ['ม.4', 'สอวน']);
  assert.equal(result.content_theme, 'สรุปเนื้อหา');
  assert.equal(result.funnel_stage, 'awareness');
  assert.equal(result.cta_type, 'website');
  assert.equal(result.cta_destination, 'chemistryk.com');
  assert.equal(result.classification_source, 'rule');
  assert.ok(result.classification_confidence >= 0.85);
  assert.equal(result.manual_tag_note, null);
});

test('classifies deadline promotion as conversion content from dictionary', () => {
  const result = classifyMarketingContent({
    caption: 'รับสมัครติวฟรี วันสุดท้าย สมัครเลยผ่าน LINE @Chemistry_k',
    platform: 'facebook',
    appliesTo: 'organic',
    dictionaryRules: DICTIONARY_RULES,
  });

  assert.equal(result.course_type, 'free_trial');
  assert.equal(result.content_theme, 'ปิดรับสมัคร');
  assert.equal(result.funnel_stage, 'conversion');
  assert.equal(result.cta_type, 'line');
  assert.equal(result.promotion_type, 'deadline');
  assert.equal(result.urgency_level, 'high');
});

test('unmatched content is flagged for manual review instead of guessing Chemistry K values', () => {
  const result = classifyMarketingContent({
    caption: 'คอนเทนต์ธุรกิจใหม่ที่ไม่มี rule เฉพาะใน dictionary',
    platform: 'tiktok',
    appliesTo: 'organic',
    dictionaryRules: DICTIONARY_RULES,
  });

  assert.deepEqual(result.course_level, []);
  assert.equal(result.course_name, null);
  assert.equal(result.content_theme, null);
  assert.equal(result.classification_confidence, 0.2);
  assert.match(result.manual_tag_note, /manual_review/);
});

function row(ruleKey, targetField, outputValue, aliases, matchType, platform, appliesTo, priority, confidence) {
  return {
    fields: {
      rule_key: ruleKey,
      target_field: targetField,
      output_value: outputValue,
      aliases,
      match_type: matchType,
      platform: platform.split(','),
      applies_to: [appliesTo],
      priority,
      confidence,
      enabled: true,
    },
  };
}
