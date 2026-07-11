import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeClassificationDictionaryRecords,
  doesRuleApplyToContext,
  mapClassificationDictionaryRecords,
  ruleMatchesText,
} from '../../packages/application/src/services/classification-dictionary.js';

test('maps Lark classification dictionary records with select-like field shapes', () => {
  const rules = mapClassificationDictionaryRecords([
    {
      recordId: 'rec_1',
      fields: {
        rule_key: 'course_level_dek73',
        target_field: [{ text: 'course_level' }],
        output_value: 'DEK73',
        aliases: 'DEK73, dek 73, เด็ก 73',
        match_type: { text: 'contains' },
        platform: [{ text: 'facebook' }, { text: 'tiktok' }],
        applies_to: [{ text: 'both' }],
        priority: 100,
        confidence: 95,
        enabled: true,
      },
    },
    {
      recordId: 'disabled',
      fields: {
        rule_key: 'disabled_rule',
        target_field: 'course_level',
        output_value: 'Disabled',
        aliases: 'disabled',
        enabled: false,
      },
    },
  ]);

  assert.equal(rules.length, 1);
  assert.equal(rules[0].rule_key, 'course_level_dek73');
  assert.equal(rules[0].target_field, 'course_level');
  assert.deepEqual(rules[0].platform, ['facebook', 'tiktok']);
  assert.deepEqual(rules[0].applies_to, ['both']);
  assert.equal(rules[0].confidence, 0.95);
  assert.equal(ruleMatchesText(rules[0], 'โปรใหม่สำหรับ DEK73'), true);
});

test('uses default confidence when the dictionary cell is empty', () => {
  const [rule] = mapClassificationDictionaryRecords([{ fields: {
    rule_key: 'default_confidence',
    target_field: 'content_theme',
    output_value: 'สรุปเนื้อหา',
    aliases: 'สรุป',
    match_type: 'contains',
    enabled: true,
  } }]);

  assert.equal(rule.confidence, 0.8);
});

test('rejects unknown match types instead of silently treating them as contains', () => {
  const rules = mapClassificationDictionaryRecords([{ fields: {
    rule_key: 'bad_match_type',
    target_field: 'content_theme',
    output_value: 'สรุปเนื้อหา',
    aliases: 'สรุป',
    match_type: 'starts_with',
    enabled: true,
  } }]);

  assert.deepEqual(rules, []);
});

test('platform-restricted rules do not apply when the caller omits platform context', () => {
  const [rule] = mapClassificationDictionaryRecords([{ fields: {
    rule_key: 'tiktok_only',
    target_field: 'content_theme',
    output_value: 'สรุปเนื้อหา',
    aliases: 'สรุป',
    platform: ['tiktok'],
    enabled: true,
  } }]);

  assert.equal(doesRuleApplyToContext(rule, { appliesTo: 'organic' }), false);
});

test('reports enabled invalid and duplicate dictionary rows while ignoring disabled rows', () => {
  const analysis = analyzeClassificationDictionaryRecords([
    { recordId: 'valid', fields: {
      rule_key: 'theme_summary',
      target_field: 'content_theme',
      output_value: 'สรุปเนื้อหา',
      aliases: 'สรุป',
      enabled: true,
    } },
    { recordId: 'invalid_match', fields: {
      rule_key: 'invalid_match',
      target_field: 'content_theme',
      output_value: 'สรุปเนื้อหา',
      aliases: 'สรุป',
      match_type: 'starts_with',
      enabled: true,
    } },
    { recordId: 'duplicate', fields: {
      rule_key: 'THEME_SUMMARY',
      target_field: 'content_theme',
      output_value: 'สรุปเนื้อหา',
      aliases: 'ตารางธาตุ',
      enabled: true,
    } },
    { recordId: 'disabled_blank', fields: { enabled: false } },
  ]);

  assert.equal(analysis.rules.length, 1);
  assert.equal(analysis.invalidRows.length, 2);
  assert.equal(analysis.disabledRows, 1);
  assert.match(analysis.invalidRows[0].reason, /unsupported match_type/);
  assert.match(analysis.invalidRows[1].reason, /duplicate rule_key/);
});

test('classification dictionary structured cells fall through blank first properties', () => {
  const [rule] = mapClassificationDictionaryRecords([{ fields: {
    rule_key: { text: '', name: 'fallback_rule_key' },
    target_field: { text: ' ', name: 'content_theme' },
    output_value: { text: '', value: 'สรุปเนื้อหา' },
    aliases: [{ text: '' }, { text: 'สรุป' }],
    enabled: true,
  } }]);

  assert.equal(rule.rule_key, 'fallback_rule_key');
  assert.equal(rule.target_field, 'content_theme');
  assert.equal(rule.output_value, 'สรุปเนื้อหา');
});


test('splits comma-separated select text inside structured Lark cells', () => {
  const [rule] = mapClassificationDictionaryRecords([{ fields: {
    rule_key: 'multi_platform_text',
    target_field: 'content_theme',
    output_value: 'สรุปเนื้อหา',
    aliases: 'สรุป',
    platform: { text: 'tiktok, facebook' },
    applies_to: { name: 'organic,both' },
    enabled: true,
  } }]);

  assert.deepEqual(rule.platform, ['tiktok', 'facebook']);
  assert.deepEqual(rule.applies_to, ['organic', 'both']);
});
