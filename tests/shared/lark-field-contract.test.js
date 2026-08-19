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

test('maps exported THB Currency UI formatter to the OpenAPI formatter while preserving currency_code', () => {
  assert.equal(normalizeLarkNumberFormatter('฿#,##0.00'), '0.00');
  assert.deepEqual(serializeLarkFieldProperty(2, {
    currency_code: 'THB',
    formatter: '฿#,##0.00',
  }), {
    currency_code: 'THB',
    formatter: '0.00',
  });
});

test('normalizes and serializes Number field property with official formatter values', () => {
  assert.deepEqual(normalizeLarkFieldProperty(2, { formatter: '#,##0' }), {
    formatter: '1,000',
  });
  assert.deepEqual(serializeLarkFieldProperty(2, { formatter: '#,##0.0000' }), {
    formatter: '0.0000',
  });
});

test('normalizes exported Formula type metadata to the documented OpenAPI request shape', () => {
  assert.deepEqual(serializeLarkFieldProperty(20, {
    formula: '{budget_micros}/1000000',
    formatter: '฿#,##0.00',
    currencyCode: 'THB',
    type: {
      dataType: 2,
      uiType: 'Currency',
      uiProperty: {
        currencyCode: 'THB',
        formatter: '฿#,##0.00',
        rangeCustomize: false,
      },
    },
  }), {
    formula_expression: '{budget_micros}/1000000',
    formatter: '0.00',
    currency_code: 'THB',
    type: {
      data_type: 2,
      ui_type: 'Currency',
      ui_property: {
        currency_code: 'THB',
        formatter: '0.00',
        range_customize: false,
      },
    },
  });
});

test('relation canonical property ignores derived table_name while preserving table_id and multiplicity', () => {
  assert.deepEqual(normalizeLarkFieldProperty(18, {
    table_id: 'tblAccounts',
    table_name: '👤 MKT_Accounts',
    multiple: false,
  }), {
    table_id: 'tblAccounts',
    multiple: false,
  });
  assert.deepEqual(serializeLarkFieldProperty(18, {
    tableId: 'tblAccounts',
    tableName: '👤 MKT_Accounts',
    multiple: true,
  }), {
    table_id: 'tblAccounts',
    multiple: true,
  });
});

test('generic field serialization preserves select option IDs for existing-field updates', () => {
  const property = {
    options: [
      { id: 'optExistingA', name: 'Active', color: 1 },
      { id: 'optExistingB', name: 'Paused', color: 2 },
    ],
  };

  assert.deepEqual(normalizeLarkFieldProperty(3, property), property);
  assert.deepEqual(serializeLarkFieldProperty(3, property), property);
});
