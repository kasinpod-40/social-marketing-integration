import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLarkFieldProperty,
  normalizeLarkNumberFormatter,
  serializeLarkFieldProperty,
} from '../../packages/shared/src/lark/lark-field-contract.js';

test('maps spreadsheet-style number formatter aliases to Lark OpenAPI enums', () => {
  assert.equal(normalizeLarkNumberFormatter('#,##0'), '1,000');
  assert.equal(normalizeLarkNumberFormatter('#,##0.00'), '1,000.00');
  assert.equal(normalizeLarkNumberFormatter('#,##0.0000'), '0.0000');
  assert.equal(normalizeLarkNumberFormatter('0.0000'), '0.0000');
});

test('normalizes and serializes Number field property with official formatter values', () => {
  assert.deepEqual(normalizeLarkFieldProperty(2, { formatter: '#,##0' }), {
    formatter: '1,000',
  });
  assert.deepEqual(serializeLarkFieldProperty(2, { formatter: '#,##0.0000' }), {
    formatter: '0.0000',
  });
});

test('keeps select option IDs in read normalization but strips generated IDs from mutation payloads', () => {
  const property = {
    options: [
      { id: 'optSourceA', name: 'Active', color: 1 },
      { id: 'optSourceB', name: 'Paused', color: 2 },
    ],
  };

  assert.deepEqual(normalizeLarkFieldProperty(3, property), property);
  assert.deepEqual(serializeLarkFieldProperty(3, property), {
    options: [
      { name: 'Active', color: 1 },
      { name: 'Paused', color: 2 },
    ],
  });
});
