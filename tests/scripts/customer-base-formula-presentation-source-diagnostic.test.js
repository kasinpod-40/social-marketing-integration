import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalFormulaPresentation,
  collectCustomerBaseFormulaPresentationEvidence,
} from '../../scripts/lib/customer-base-formula-presentation-evidence.js';

const FORMULA_TYPE = 20;

function formula(fieldName, property = {}) {
  return {
    fieldName,
    type: FORMULA_TYPE,
    property: {
      formula_expression: `FORMULA(${fieldName})`,
      ...property,
    },
  };
}

function sourceClient(overrides = {}) {
  const fields = new Map([
    ['campaigns', [
      { fieldName: 'campaign_key', type: 1, property: null },
      formula('budget', {
        type: {
          dataType: 2,
          uiType: 'Currency',
          uiProperty: {
            currencyCode: 'THB',
            formatter: '฿#,##0.00',
          },
        },
      }),
    ]],
    ['daily', [
      formula('all_conversion_value', {
        type: { data_type: 2, ui_type: 'Number', ui_property: { formatter: '0.00' } },
      }),
      formula('cost_per_conversion', {
        type: { data_type: 2, ui_type: 'Number', ui_property: { formatter: '0.00' } },
      }),
      formula('conversion_rate', {
        type: { data_type: 2, ui_type: 'Percent', ui_property: { formatter: '0.00%' } },
      }),
    ]],
  ]);
  if (overrides.fields) overrides.fields(fields);

  return {
    async listTables() {
      return [
        { tableId: 'campaigns', name: '📣 MKT_Ads_Campaigns' },
        { tableId: 'daily', name: '📈 MKT_Ads_Daily' },
      ];
    },
    async listFields({ tableId }) {
      return fields.get(tableId) ?? [];
    },
  };
}

test('collects exactly four approved Formula presentations without formula expressions', async () => {
  const result = await collectCustomerBaseFormulaPresentationEvidence(sourceClient());

  assert.equal(result.ok, true);
  assert.equal(result.formulaCount, 4);
  assert.deepEqual(result.formulas.map(({ tableName, fieldName }) => ({ tableName, fieldName })), [
    { tableName: '📈 MKT_Ads_Daily', fieldName: 'all_conversion_value' },
    { tableName: '📈 MKT_Ads_Daily', fieldName: 'conversion_rate' },
    { tableName: '📈 MKT_Ads_Daily', fieldName: 'cost_per_conversion' },
    { tableName: '📣 MKT_Ads_Campaigns', fieldName: 'budget' },
  ]);
  assert.equal(JSON.stringify(result).includes('formula_expression'), false);
  assert.equal(result.remoteRequestCount, 0);
  assert.equal(result.remoteMutationCount, 0);
});

test('canonicalizes Formula UI aliases through the shared Lark field contract', () => {
  const presentation = canonicalFormulaPresentation({
    formula_expression: 'SHOULD_NOT_SURVIVE',
    type: {
      dataType: 2,
      uiType: 'Currency',
      uiProperty: {
        currencyCode: 'THB',
        formatter: '฿#,##0.00',
      },
    },
  });

  assert.deepEqual(presentation, {
    type: {
      data_type: 2,
      ui_property: {
        currency_code: 'THB',
        formatter: '0.00',
      },
      ui_type: 'Currency',
    },
  });
});

test('fails closed when an approved Formula is missing', async () => {
  await assert.rejects(
    () => collectCustomerBaseFormulaPresentationEvidence(sourceClient({
      fields(fields) {
        fields.set('daily', fields.get('daily').filter((field) => field.fieldName !== 'conversion_rate'));
      },
    })),
    (error) => error?.code === 'CUSTOMER_BASE_FORMULA_PRESENTATION_IDENTITY_MISMATCH'
      && error?.details?.missing?.some((item) => item.fieldName === 'conversion_rate'),
  );
});

test('fails closed when Source contains an unexpected Formula identity', async () => {
  await assert.rejects(
    () => collectCustomerBaseFormulaPresentationEvidence(sourceClient({
      fields(fields) {
        fields.get('daily').push(formula('unexpected_formula'));
      },
    })),
    (error) => error?.code === 'CUSTOMER_BASE_FORMULA_PRESENTATION_IDENTITY_MISMATCH'
      && error?.details?.unexpected?.some((item) => item.fieldName === 'unexpected_formula'),
  );
});
