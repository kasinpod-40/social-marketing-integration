import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const evidenceSource = await readFile(
  new URL('../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js', import.meta.url),
  'utf8',
);
const promptSource = await readFile(
  new URL('../../packages/config/src/lark-native-ai-automation-prompt-contract.js', import.meta.url),
  'utf8',
);

test('compact Weekly evidence writer contract stays aligned with Prompt v3 recommendation semantics', () => {
  assert.match(evidenceSource, /1 label\/line/u);
  assert.match(evidenceSource, /ตรวจสอบ-only invalid/u);
  assert.match(evidenceSource, /c=\[\]=>no CONTENT\/Organic/u);
  assert.match(evidenceSource, /a=>Paid name,never CONTENT/u);
  assert.match(evidenceSource, /c=\[\]\+a\+funnel=>paid\+NO-SCALE only/u);
  assert.match(evidenceSource, /NO-SCALE:1 line;1 up\+1 down metric;concrete action/u);

  assert.doesNotMatch(evidenceSource, /funnel => NO-SCALE broad budget/u);
  assert.doesNotMatch(evidenceSource, /Organic no Paid=>TEST/u);

  assert.match(promptSource, /หนึ่ง action ต่อหนึ่งบรรทัด/u);
  assert.match(promptSource, /ถ้า c=\[\] ห้ามใช้ \[CONTENT\]/u);
  assert.match(promptSource, /candidate ที่อยู่ใน a ห้ามใช้ \[CONTENT\]/u);
  assert.match(promptSource, /ไม่ต้องเติม Organic action เพื่อให้ครบ 4 ข้อ/u);
});
