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

test('parses quoted values with inline comments and preserves hash characters inside secrets', () => {
  assert.deepEqual(parseDevVars(`
TOKEN="abc#123" # คอมเมนต์หลังค่า
PASSWORD=pass#word
ESCAPED="say \\"hello\\""
`), {
    TOKEN: 'abc#123',
    PASSWORD: 'pass#word',
    ESCAPED: 'say "hello"',
  });
});

test('rejects unclosed quoted values instead of silently loading a broken secret', () => {
  assert.throws(() => parseDevVars('TOKEN="broken'), /Unclosed quote/);
});

test('preserves backslashes for unsupported escape sequences inside quoted secrets', () => {
  assert.deepEqual(parseDevVars(String.raw`
WINDOWS_PATH="C:\temp\new"
REGEX='\d+\s+items'
BACKSLASH="one\\two"
`), {
    WINDOWS_PATH: String.raw`C:\temp\new`,
    REGEX: String.raw`\d+\s+items`,
    BACKSLASH: String.raw`one\two`,
  });
});
