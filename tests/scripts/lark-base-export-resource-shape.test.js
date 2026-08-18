import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLarkBaseExportResourceShapes } from '../../scripts/lib/lark-base-export-resource-shape.js';

test('resource shape audit exposes structure without primitive values', () => {
  const result = inspectLarkBaseExportResourceShapes({
    dashboards: [{ block_id: 'blk_secret', data_config: { table_id: 'tbl_secret', metric: 'Revenue' } }],
    workflows: [{ workflow_id: 'wkf_secret', title: 'Send secret message', steps: [{ field_id: 'fld_secret' }] }],
    roles: [{ role_id: 'rol_secret', role_name: 'Client', table_roles: [{ table_id: 'tbl_secret', perm: 2 }] }],
    accessConfig: { owner_token: 'user_secret', public: false },
    extraInfo: { revision: 42 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.remoteRequestCount, 0);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.resources.dashboards.rootType, 'array');
  assert.deepEqual(result.resources.dashboards.arrayLengths, [{ path: '$', lengths: [1] }]);
  assert.ok(result.resources.roles.paths.some((item) => item.path === '$[].table_roles[].table_id' && item.type === 'string'));
  assert.ok(result.resources.workflows.paths.some((item) => item.path === '$[].steps[].field_id' && item.type === 'string'));
  assert.ok(result.resources.dashboards.referenceKeyCounts.block_id > 0);

  const serialized = JSON.stringify(result);
  for (const forbidden of ['blk_secret', 'tbl_secret', 'wkf_secret', 'Send secret message', 'rol_secret', 'Client', 'user_secret', 'Revenue']) {
    assert.equal(serialized.includes(forbidden), false, `must redact value ${forbidden}`);
  }
});

test('resource shape audit merges repeated paths and reports bounded truncation', () => {
  const result = inspectLarkBaseExportResourceShapes({
    dashboards: Array.from({ length: 10 }, (_, index) => ({ block_id: `blk_${index}`, nested: { value: index } })),
    workflows: [],
    roles: [],
    accessConfig: {},
    extraInfo: {},
  }, { maxArraySamples: 2, maxDepth: 3, maxPaths: 50 });

  const blockIdPath = result.resources.dashboards.paths.find((item) => item.path === '$[].block_id');
  assert.equal(blockIdPath.occurrences, 2);
  assert.equal(result.resources.dashboards.truncated, true);
});
