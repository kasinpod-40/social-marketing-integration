import test from 'node:test';
import assert from 'node:assert/strict';
import { readLarkTableIdsFromEnv } from '../../packages/config/src/lark-table-config.js';

test('resolves required Lark table ids from env only', () => {
  const result = readLarkTableIdsFromEnv({
    LARK_TABLE_MKT_CONTENT: ' tbl_content ',
    LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY: 'tbl_dictionary',
  }, ['mktContent', 'mktClassificationDictionary']);

  assert.deepEqual(result, {
    mktContent: 'tbl_content',
    mktClassificationDictionary: 'tbl_dictionary',
  });
});

test('fails clearly when a required Lark table id env is missing', () => {
  assert.throws(
    () => readLarkTableIdsFromEnv({}, ['mktContent']),
    /LARK_TABLE_MKT_CONTENT/,
  );
});
