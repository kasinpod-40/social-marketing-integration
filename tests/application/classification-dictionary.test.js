import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
