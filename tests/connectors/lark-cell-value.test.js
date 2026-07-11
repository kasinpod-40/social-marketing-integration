import test from 'node:test';
import assert from 'node:assert/strict';
import { readLarkNumber, readLarkText, readLarkUrl } from '../../packages/connectors/src/shared/lark-cell-value.js';

test('reads Lark rich text, URL arrays, and primitive numbers', () => {
  assert.equal(readLarkText([{ type: 'text', text: 'hello' }]), 'hello');
  assert.equal(readLarkUrl([{ type: 'url', link: 'https://example.com/a', text: 'open' }]), 'https://example.com/a');
  assert.equal(readLarkNumber(1200), 1200);
});

test('never coerces malformed objects into text or URLs', () => {
  assert.equal(readLarkText([{ unknown: 'value' }]), null);
  assert.throws(() => readLarkUrl([{ type: 'url', text: 'not-a-url' }]), /absolute http\/https URL/);
});

test('falls through blank structured candidates instead of hiding a valid fallback value', () => {
  assert.equal(readLarkText({ text: '   ', name: 'fallback text' }), 'fallback text');
  assert.equal(
    readLarkUrl({ link: '   ', url: 'https://example.com/fallback' }),
    'https://example.com/fallback',
  );
  assert.equal(readLarkNumber({ value: '', text: '1,250' }), 1250);
});
