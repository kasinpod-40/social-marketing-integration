import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractReviewedRemoteExecutionFlagMap,
  extractReviewedRemoteTrueExecutionFlags,
} from '../../scripts/lib/report-runtime-closeout-reviewed-remote.js';

test('reviewed remote verifier admits plain-text and JSON Boolean execution flags', () => {
  const bindings = [
    { type: 'plain_text', name: 'MKT_REPORT_D1_READ_ENABLED', text: 'true' },
    { type: 'json', name: 'MKT_CONNECTOR_FACEBOOK_ENABLED', json: true },
    { type: 'json', name: 'MKT_CONNECTOR_INSTAGRAM_ENABLED', json: false },
    { type: 'plain_text', name: 'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED', text: 'false' },
    { type: 'secret_text', name: 'LARK_APP_SECRET' },
  ];

  assert.deepEqual(extractReviewedRemoteExecutionFlagMap(bindings), {
    MKT_CONNECTOR_FACEBOOK_ENABLED: true,
    MKT_CONNECTOR_INSTAGRAM_ENABLED: false,
    MKT_REPORT_D1_READ_ENABLED: true,
    MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: false,
  });
  assert.deepEqual(extractReviewedRemoteTrueExecutionFlags(bindings), [
    'MKT_CONNECTOR_FACEBOOK_ENABLED',
    'MKT_REPORT_D1_READ_ENABLED',
  ]);
});

test('reviewed remote verifier rejects non-Boolean JSON execution flags', () => {
  assert.throws(
    () => extractReviewedRemoteExecutionFlagMap([
      { type: 'json', name: 'MKT_CONNECTOR_FACEBOOK_ENABLED', json: 'true' },
    ]),
    {
      code: 'REPORT_RUNTIME_CLOSEOUT_REMOTE_FLAG_VALUE_INVALID',
      details: {
        flagName: 'MKT_CONNECTOR_FACEBOOK_ENABLED',
        bindingType: 'json',
        valueType: 'string',
      },
    },
  );
});

test('reviewed remote verifier rejects unsupported execution binding types', () => {
  assert.throws(
    () => extractReviewedRemoteExecutionFlagMap([
      { type: 'secret_text', name: 'MKT_CONNECTOR_FACEBOOK_ENABLED' },
    ]),
    {
      code: 'REPORT_RUNTIME_CLOSEOUT_REMOTE_FLAG_BINDING_TYPE_INVALID',
      details: {
        flagName: 'MKT_CONNECTOR_FACEBOOK_ENABLED',
        bindingType: 'secret_text',
      },
    },
  );
});

test('reviewed remote verifier rejects conflicting duplicate execution flags', () => {
  assert.throws(
    () => extractReviewedRemoteExecutionFlagMap([
      { type: 'plain_text', name: 'MKT_REPORT_D1_READ_ENABLED', text: 'true' },
      { type: 'json', name: 'MKT_REPORT_D1_READ_ENABLED', json: false },
    ]),
    {
      code: 'REPORT_RUNTIME_CLOSEOUT_REMOTE_FLAG_DUPLICATE',
      details: { flagName: 'MKT_REPORT_D1_READ_ENABLED' },
    },
  );
});
