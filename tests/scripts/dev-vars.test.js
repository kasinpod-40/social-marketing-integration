import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDevVars } from '../../scripts/lib/dev-vars.js';

test('parses .dev.vars style values safely', () => {
  const result = parseDevVars(`
# comment
APP_ENV=local
export LARK_APP_ID=cli_xxx
LARK_APP_SECRET="secret value"
LARK_TABLE_MKT_CONTENT=tbl_content # inline comment
invalid line
`);

  assert.deepEqual(result, {
    APP_ENV: 'local',
    LARK_APP_ID: 'cli_xxx',
    LARK_APP_SECRET: 'secret value',
    LARK_TABLE_MKT_CONTENT: 'tbl_content',
  });
});
